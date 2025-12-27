#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { spawnSync } from 'child_process';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { print, symbols, executeCommand, executeInteractiveCommand, requiresSudo, createReadlineInterface, promptUser } from './utils.js';
import { resolveWorkspaceRoot } from './lib/workspace-path.js';
import { readJSON, writeJSON, replaceVariables, replaceVariablesInObject } from './lib/config.js';
import { readEnvFile } from './lib/env.js';
import { setupEnvFile } from './install/env.js';
import { generateMcpJson, checkMcpServers } from './install/mcp.js';
import { processCheck } from './install/process-check.js';
import type { WorkspaceConfig } from './schemas/workspace-config.zod.js';
import { fileURLToPath } from 'url';
import { createInstallLogger } from './install/logger.js';
import { runInstall, type InstallContext, type InstallStep } from './install/runner.js';
import type { InstallLogger } from './install/logger.js';
import {
  checkFileExists,
  copySeedFilesFromProvidedWorkspaceConfig,
  createProjectSymlink,
  createProjectSymlinkToTarget,
  formatBytes,
  getDirectorySize,
  getProjectName,
  isExistingDirectory,
  isFilePath,
  isHttpRequest,
  resolveProjectSrcToWorkspacePath,
} from './install/installer-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
// Script is in scripts/ directory, so project root is parent directory
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Find workspace root by looking for workspace.config.json
 */
function findWorkspaceRoot(startPath = PROJECT_ROOT) {
  let current = path.resolve(startPath);
  const maxDepth = 10;
  let depth = 0;
  
  while (depth < maxDepth) {
    const configPath = path.join(current, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }
    
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    depth++;
  }
  
  return null;
}

// Parse CLI arguments using yargs
const argv = yargs(hideBin(process.argv))
  .option('workspace-path', {
    type: 'string',
    description: 'Path to workspace directory'
  })
  .option('workspace-config', {
    type: 'string',
    description: 'Path to an existing workspace.config.json to use when creating a workspace'
  })
  .option('modules', {
    type: 'string',
    description: 'Comma-separated list of modules to install'
  })
  .option('ai-agent', {
    type: 'string',
    description: 'AI agent to use'
  })
  .option('repo-type', {
    type: 'string',
    description: 'Repository type'
  })
  .option('skip-repo-init', {
    type: 'boolean',
    default: false,
    description: 'Skip repository initialization'
  })
  .option('config', {
    type: 'string',
    description: 'Path to configuration file'
  })
  .option('y', {
    alias: ['yes', 'non-interactive', 'unattended'],
    type: 'boolean',
    default: false,
    description: 'Non-interactive mode (auto-yes)'
  })
  .option('check-tokens-only', {
    type: 'boolean',
    default: false,
    description: 'Only check if required tokens are present'
  })
  .option('status', {
    type: 'boolean',
    default: false,
    description: 'Show installation status'
  })
  .option('test-checks', {
    type: 'string',
    description: 'Comma-separated list of checks to test (without installation)',
    coerce: (value) => value ? value.split(',').map(c => c.trim()).filter(c => c.length > 0) : null
  })
  .option('checks', {
    type: 'string',
    description: 'Comma-separated list of checks to run (with installation)',
    coerce: (value) => value ? value.split(',').map(c => c.trim()).filter(c => c.length > 0) : null
  })
  .help()
  .alias('help', 'h')
  .argv;

const WORKSPACE_PATH = argv['workspace-path'];
const WORKSPACE_CONFIG_PATH = argv['workspace-config'];
const INSTALL_MODULES = argv.modules;
const AI_AGENT = argv['ai-agent'];
const REPO_TYPE = argv['repo-type'];
const SKIP_REPO_INIT = argv['skip-repo-init'];
const CONFIG_FILE_PATH = argv.config;

// Determine workspace root
let WORKSPACE_ROOT;
if (WORKSPACE_PATH) {
  WORKSPACE_ROOT = resolveWorkspaceRoot(WORKSPACE_PATH, { projectRoot: PROJECT_ROOT, findWorkspaceRoot });
} else {
  WORKSPACE_ROOT = findWorkspaceRoot() || PROJECT_ROOT;
}

const CONFIG_FILE = path.join(WORKSPACE_ROOT, 'workspace.config.json');
const CACHE_DIR = path.join(WORKSPACE_ROOT, '.cache');
// NOTE: `.cache/install-check.json` is deprecated; use `.cache/install-state.json` instead.
const LOG_FILE = path.join(CACHE_DIR, 'install.log');
const ENV_FILE = path.join(WORKSPACE_ROOT, '.env');
const CURSOR_DIR = path.join(WORKSPACE_ROOT, '.cursor');
const MCP_FILE = path.join(CURSOR_DIR, 'mcp.json');
const PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'projects');

const DEFAULT_TIER = 'pre-install';

let installLogger: InstallLogger | null = null;

// CLI flags
const AUTO_YES = argv.y || argv.yes || argv['non-interactive'] || argv.unattended;
const CHECK_TOKENS_ONLY = argv['check-tokens-only'];
const STATUS_ONLY = argv.status;
const TEST_CHECKS = argv['test-checks'];
const CHECKS = argv.checks;

/**
 * Initialize logging
 */
function initLogging() {
  // Ensure cache directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  // Universal pino-compatible logger (levels-only), file sink only.
  // Keep the same log file location.
  installLogger = createInstallLogger(WORKSPACE_ROOT, { filePath: LOG_FILE });
  log(`install.start`);
}

/**
 * Write to log file
 */
function log(message: string): void {
  // Backward-compatible helper for existing code paths.
  // Prefer ctx.logger in new runner/steps.
  if (!installLogger) return;
  installLogger.info(message);
}




interface CheckItem {
  name: string;
  description?: string;
  test?: string;
  install?: string;
  mcpSettings?: Record<string, unknown>;
  _execCwd?: string;
  [key: string]: unknown;
}

/**
 * Install software using install command
 */
async function installSoftware(item: CheckItem): Promise<boolean> {
  const { name, description, install } = item;
  
  print(`  ${symbols.info} Installation command found for ${name}`, 'cyan');
  log(`Installation command: ${install}`);
  
  // Ask user if they want to install (unless running in non-interactive mode)
  let answer = 'y';
  if (!AUTO_YES) {
    const rl = createReadlineInterface();
    answer = await promptUser(rl, `  Do you want to install ${name}? (y/n) [y]: `);
    rl.close();
  } else {
    print(`  ${symbols.info} Non-interactive mode: auto-installing ${name}`, 'cyan');
    log(`Non-interactive mode: auto-installing ${name}`);
  }
  
  if (answer.toLowerCase() !== 'n' && answer.toLowerCase() !== 'no') {
    print(`  Installing ${name}...`, 'cyan');
    log(`Executing installation command: ${install}`);
    
    try {
      // Execute installation command
      // Use interactive mode for sudo commands to allow password input
      const isSudo = requiresSudo(install);
      const result = isSudo 
        ? executeInteractiveCommand(install)
        : executeCommand(install, { shell: '/bin/bash', cwd: item._execCwd });
      
      if (result.success) {
        print(`  ${symbols.success} Installation command completed`, 'green');
        log(`  Installation SUCCESS - Output: ${result.output || '(interactive)'}`);
        return true;
      } else {
        print(`  ${symbols.error} Installation failed: ${result.error || 'Command failed'}`, 'red');
        log(`  Installation FAILED - Error: ${result.error || 'Command failed'}`);
        if (result.output) {
          log(`  Installation output: ${result.output}`);
        }
        return false;
      }
    } catch (error) {
      const err = error as Error;
      print(`  ${symbols.error} Installation error: ${err.message}`, 'red');
      log(`  Installation ERROR - ${err.message}`);
      return false;
    }
  } else {
    print(`  ${symbols.warning} Installation skipped by user`, 'yellow');
    log(`Installation skipped by user`);
    return false;
  }
}

// NOTE: a number of installer helper functions were extracted to ./install/installer-utils.ts
// to keep this entrypoint focused on orchestration and check execution.

interface CheckResult {
  name: string;
  passed: boolean | null;
  version?: string | null;
  note?: string;
  filePath?: string;
  tier?: string;
  skipped?: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Check software/command installation
 */
async function checkCommand(item: CheckItem, context: string | null = null, skipInstall = false): Promise<CheckResult> {
  const { name, description, test, install } = item;
  const contextSuffix = context ? ` [${context}]` : '';
  
  print(`Checking ${name}${contextSuffix}...`, 'cyan');
  log(`Checking command: ${name} (${description})`);
  
  // Read .env file for variable substitution
  const env = readEnvFile(ENV_FILE);
  
  // Note: Token checking for auth checks is handled by processCheck function
  // This function is called from processCheck after token validation
  
  // Default test for MCP checks: if no explicit test provided, verify MCP via tools/list
  // using scripts/test-mcp.js against the generated .cursor/mcp.json configuration.
  let effectiveTest = test;
  if ((!effectiveTest || typeof effectiveTest !== 'string' || !effectiveTest.trim()) && item.mcpSettings && name) {
    effectiveTest = `node "${path.join(PROJECT_ROOT, 'scripts', 'test-mcp.js')}" "${name}"`;
  }

  // If no test command, skip verification
  if (!effectiveTest) {
    print(`${symbols.warning} ${name} - No test command specified`, 'yellow');
    if (description) {
      print(description, 'yellow');
    }
    log(`No test command specified for ${name}`);
    return {
      name: name,
      passed: false,
      version: null,
      note: 'No test command specified'
    };
  }
  
  // Replace variables in test and install commands
  const testWithVars = replaceVariablesWithLog(effectiveTest, env);
  const installWithVars = install ? replaceVariablesWithLog(install, env) : install;
  
  try {
    // Check if test is a file path or a command
    if (isFilePath(testWithVars)) {
      // It's a file/directory path - check if it exists
      log(`File/directory path: ${testWithVars}`);
      
      const fileCheck = checkFileExists(testWithVars, { baseDir: PROJECT_ROOT });
      
      if (fileCheck.exists && (fileCheck.isFile || fileCheck.isDirectory)) {
        const typeLabel = fileCheck.isDirectory ? 'Directory' : 'File';
        print(`${symbols.success} ${name} - OK`, 'green');
        log(`Result: SUCCESS - ${typeLabel} exists: ${fileCheck.path}`);
        
        return {
          name: name,
          passed: true,
          version: fileCheck.isDirectory ? 'directory exists' : 'file exists',
          filePath: fileCheck.path
        };
      } else {
        // File/directory not found
        print(`${symbols.error} ${name} - Path not found: ${testWithVars}`, 'red');
        if (description) {
          print(description, 'red');
        }
        const docs = (item as { docs?: string }).docs;
        if (docs) {
          print(docs, 'red');
        }
        log(`Result: FAILED - Path not found: ${fileCheck.path}`);
        
        // If install command is available, offer to install (unless skipInstall is true)
        if (installWithVars && !skipInstall) {
          // Create item with replaced variables for installation
          const itemWithVars = { ...item, install: installWithVars };
          const installed = await installSoftware(itemWithVars);
          
          if (installed) {
            // Re-check after installation
            print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
            log(`Re-checking ${name} after installation`);
            
            const recheckFile = checkFileExists(testWithVars, { baseDir: PROJECT_ROOT });
            
            if (recheckFile.exists && (recheckFile.isFile || recheckFile.isDirectory)) {
              const typeLabel = recheckFile.isDirectory ? 'Directory' : 'File';
              print(`${symbols.success} ${name} - OK`, 'green');
              log(`Re-check SUCCESS - ${typeLabel} exists: ${recheckFile.path}`);
              
              return {
                name: name,
                passed: true,
                version: recheckFile.isDirectory ? 'directory exists' : 'file exists',
                filePath: recheckFile.path,
                note: 'Installed during setup'
              };
            } else {
              print(`${symbols.warning} ${name} - Installation completed but path not found`, 'yellow');
              if (description) {
                print(description, 'yellow');
              }
              log(`Re-check FAILED - Installation may have succeeded but path not found`);
              
              return {
                name: name,
                passed: false,
                version: null,
                note: 'Installation attempted but path not found'
              };
            }
          }
        }
        
        return {
          name: name,
          passed: false,
          version: null,
          filePath: fileCheck.path
        };
      }
    } else {
      // It's a command - execute it
      log(`Command: ${testWithVars}`);
      
      // Special handling for nvm - need to source it first
      let command = testWithVars;
      if (name === 'nvm') {
        command = `source ~/.nvm/nvm.sh && ${testWithVars}`;
      }
      
      // Handle API calls (commands starting with "api ")
      let apiCommandHandled = false;
      if (command.trim().startsWith('api ')) {
        const apiCommand = command.trim().substring(4); // Remove "api " prefix
        command = `npm run call -- ${apiCommand}`;
        apiCommandHandled = true;
      }
      
      // For project checks, run command from projects/<projectName> if it exists
      // For API commands, always run from workspace root
      const execOptions: { cwd?: string } = {};
      if (apiCommandHandled) {
        // API commands should run from workspace root
        execOptions.cwd = WORKSPACE_ROOT || process.cwd();
      } else if (context) {
        const projectCwd = path.join(PROJECTS_DIR, context);
        try {
          if (fs.existsSync(projectCwd) && fs.statSync(projectCwd).isDirectory()) {
            execOptions.cwd = projectCwd;
          }
        } catch {
          // ignore
        }
      }
      
      // Use interactive mode for sudo commands to allow password input
      const isSudo = requiresSudo(command);
      const result = isSudo ? executeInteractiveCommand(command) : executeCommand(command, execOptions);
      
      // For API commands, check if output is "true" to determine success
      let commandSuccess = result.success;
      if (apiCommandHandled && result.success) {
        const resultValue = result.output?.trim().split('\n').pop()?.trim() || '';
        commandSuccess = resultValue === 'true';
      }
      
      if (commandSuccess) {
        // For test-type checks or auth checks with test commands that produce no output,
        // show "OK" instead of "unknown" to indicate the check passed
        const isTestCheck = item.type === 'test' || (item.type === 'auth' && item.test);
        const version = isSudo 
          ? 'passed' 
          : (result.output || (isTestCheck ? 'OK' : 'unknown'));
        print(`${symbols.success} ${name} - ${version}`, 'green');
        log(`Result: SUCCESS - Version: ${version}`);
        
        return {
          name: name,
          passed: true,
          version: version
        };
      } else {
        // Software not installed or auth check failed
        const itemVar = (item as { var?: string }).var;
        const isAuth = item.type === 'auth' && itemVar;
        // If this is an auth check using API command, show return value for clarity
        let errorLabel: string;
        if (item.type === 'auth' && itemVar && testWithVars && testWithVars.trim().startsWith('api ')) {
          const returnValue = result.output || result.error || 'failed';
          errorLabel = `the ${itemVar} exist but "${testWithVars}" returned ${returnValue}`;
        } else if (item.type === 'auth' && itemVar) {
          errorLabel = `${itemVar} check failed`;
        } else {
          errorLabel = 'Not installed';
        }
        print(`${symbols.error} ${name} - ${errorLabel}`, 'red');
        if (description) {
          print(description, 'red');
        }
        const docs = (item as { docs?: string }).docs;
        if (docs) {
          print(docs, 'red');
        }
        log(`Result: FAILED - ${errorLabel}${result.error ? ` (${result.error})` : ''}`);
        
        // If install command is available, offer to install (unless skipInstall is true)
        if (install && !skipInstall) {
          const itemWithCwd = { ...item, _execCwd: execOptions.cwd };
          const installed = await installSoftware(itemWithCwd);
          
          if (installed) {
            // Re-check after installation
            print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
            log(`Re-checking ${name} after installation`);
            
            const recheckResult = isSudo ? executeInteractiveCommand(command) : executeCommand(command, execOptions);
            
            if (recheckResult.success) {
              // For test-type checks or auth checks with test commands that produce no output,
              // show "OK" instead of "unknown" to indicate the check passed
              const isTestCheck = item.type === 'test' || (item.type === 'auth' && item.test);
              const version = isSudo 
                ? 'passed' 
                : (recheckResult.output || (isTestCheck ? 'OK' : 'unknown'));
              print(`${symbols.success} ${name} - ${version}`, 'green');
              log(`Re-check SUCCESS - Version: ${version}`);
              
              return {
                name: name,
                passed: true,
                version: version,
                note: 'Installed during setup'
              };
            } else {
              const retryErrorLabel = isAuth
                ? `${itemVar} check failed`
                : 'Installation completed but verification failed';
              print(`${symbols.warning} ${name} - ${retryErrorLabel}`, 'yellow');
              if (description) {
                print(description, 'yellow');
              }
              log(`Re-check FAILED - ${retryErrorLabel}`);
              
              return {
                name: name,
                passed: false,
                version: null,
                note: isAuth ? retryErrorLabel : 'Installation attempted but verification failed'
              };
            }
          }
        }
        
        return {
          name: name,
          passed: false,
          version: null,
          note: isAuth ? `${itemVar} check failed` : undefined
        };
      }
    }
  } catch (error) {
    const err = error as Error;
    print(`${symbols.error} ${name} - Error: ${err.message}`, 'red');
    if (description) {
      print(description, 'red');
    }
    const docs = (item as { docs?: string }).docs;
    if (docs) {
      print(docs, 'red');
    }
    log(`Result: ERROR - ${err.message}`);
    
    return {
      name: name,
      passed: false,
      version: null
    };
  }
}

interface HttpRequestResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  body: string | null;
  timeout?: boolean;
}

/**
 * Make HTTP request
 */
function makeHttpRequest(method: string, url: string, headers: Record<string, string> = {}): Promise<HttpRequestResult> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers,
      timeout: 10000
    };
    
    const req = httpModule.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const statusCode = res.statusCode;
        // For MCP servers, even error responses (like -32000) indicate the server is working
        // We consider 2xx, 3xx, and 4xx (except 404) as "server is reachable"
        const isSuccess = statusCode >= 200 && statusCode < 500 && statusCode !== 404;
        
        resolve({
          success: isSuccess,
          statusCode: statusCode,
          error: null,
          body: data
        });
      });
    });
    
    req.on('error', (error) => {
      resolve({
        success: false,
        statusCode: null,
        error: error.message,
        body: null
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        statusCode: null,
        error: 'Request timeout',
        body: null
      });
    });
    
    req.end();
  });
}



/**
 * Parse .env file content
 */
// readEnvFile is imported from lib/env.ts

/**
 * Replace variables in string (format: $VAR_NAME)
 */
// Helper wrappers for replaceVariables with logging
function replaceVariablesWithLog(str: string, env: Record<string, string>): string {
  return replaceVariables(str, env, log, print, symbols);
}

function replaceVariablesInObjectWithLog(obj: unknown, env: Record<string, string>): unknown {
  return replaceVariablesInObject(obj, env, log, print, symbols);
}

/**
 * Check HTTP access to service
 */
async function checkHttpAccess(item: CheckItem, context: string | null = null): Promise<CheckResult> {
  const { name, description, test } = item;
  const contextSuffix = context ? ` [${context}]` : '';
  
  print(`Checking ${name}${contextSuffix}...`, 'cyan');
  log(`Checking HTTP access: ${name} (${description})`);
  log(`Request: ${test}`);
  
  try {
    // Parse "GET https://..." format
    const parts = test.trim().split(/\s+/);
    const method = parts[0] || 'GET';
    const url = parts.slice(1).join(' ');
    
    if (!url) {
      throw new Error('Invalid test format: missing URL');
    }
    
    const result = await makeHttpRequest(method, url);
    
    if (result.success) {
      print(`${symbols.success} ${name} - OK`, 'green');
      log(`Result: SUCCESS - Status: ${result.statusCode}`);
      
      return {
        name: name,
        passed: true,
        statusCode: result.statusCode
      };
    } else {
      print(`${symbols.error} ${name} - Failed (${result.statusCode || result.error})`, 'red');
      if (description) {
        print(description, 'red');
      }
      const docs = (item as { docs?: string }).docs;
      if (docs) {
        print(docs, 'red');
      }
      log(`Result: FAILED - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      
      return {
        name: name,
        passed: false,
        error: result.error || `HTTP ${result.statusCode}`
      };
    }
  } catch (error) {
    const err = error as Error;
    print(`${symbols.error} ${name} - Error: ${err.message}`, 'red');
    if (description) {
      print(description, 'red');
    }
    const docs = (item as { docs?: string }).docs;
    if (docs) {
      print(docs, 'red');
    }
    log(`Result: ERROR - ${err.message}`);
    
    return {
      name: name,
      passed: false,
      error: err.message
    };
  }
}

// NOTE: Legacy project processing helpers were removed because they were unused.
/**
 * Run selected checks (from config.checks or config.projects)
 */
async function runSelectedChecks(checkNames: string[], testOnly = false): Promise<void> {
  initLogging();
  
  print(`\n${symbols.search} Running selected checks: ${checkNames.join(', ')}...\n`, 'blue');
  log(`Running selected checks: ${checkNames.join(', ')} (testOnly: ${testOnly})`);
  
  // Read configuration
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${CONFIG_FILE}`, 'red');
    log(`ERROR: Cannot read configuration file: ${CONFIG_FILE}`);
    process.exit(1);
  }
  
  // Read .env file for variable substitution
  const env = readEnvFile(ENV_FILE);
  
  // Collect all checks from config.checks and config.projects
  const allChecks = [];
  
  // Add checks from config.checks
  if (config.checks && Array.isArray(config.checks)) {
    for (const check of config.checks) {
      if (checkNames.includes(check.name)) {
        allChecks.push({ ...check, source: 'config' });
      }
    }
  }
  
  // Add checks from config.projects
  if (config.projects && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      if (project.checks && Array.isArray(project.checks)) {
        const projectName = getProjectName(project.src);
        for (const check of project.checks) {
          if (checkNames.includes(check.name)) {
            allChecks.push({ ...check, source: 'project', projectName });
          }
        }
      }
    }
  }
  
  if (allChecks.length === 0) {
    print(`${symbols.warning} No checks found with names: ${checkNames.join(', ')}`, 'yellow');
    log(`No checks found with names: ${checkNames.join(', ')}`);
    process.exit(1);
  }
  
  // Check for missing check names
  const foundNames = allChecks.map(c => c.name);
  const missingNames = checkNames.filter(name => !foundNames.includes(name));
  if (missingNames.length > 0) {
    print(`${symbols.warning} Some checks not found: ${missingNames.join(', ')}`, 'yellow');
    log(`Some checks not found: ${missingNames.join(', ')}`);
  }
  
  print(`\n${symbols.info} Found ${allChecks.length} check(s) to run...\n`, 'cyan');
  
  const results = [];
  
  for (const check of allChecks) {
    // Determine context type based on source
    const contextType = check.source === 'project' ? 'project' : 'workspace';
    const contextName = check.projectName || null;
    
    // Replace variables in check
    const checkWithVars = replaceVariablesInObjectWithLog(check, env);
    
    // Skip check if skip=true in config
    if (checkWithVars.skip === true) {
      const prefix = contextName ? `[${contextName}] ` : '';
      print(`  ${symbols.warning} ${prefix}${check.name}: skipped`, 'yellow');
      log(`${prefix}CHECK SKIPPED: ${check.name}`);
      results.push({
        name: check.name,
        description: check.description || '',
        passed: null,
        skipped: true
      });
      continue;
    }
    
    // Use unified processCheck function
    const checkResult = await processCheck(
      contextType,
      contextName,
      checkWithVars as CheckItem,
      {
        skipInstall: testOnly,
        workspaceRoot: WORKSPACE_ROOT,
        checkCommand,
        checkHttpAccess,
        isHttpRequest,
        replaceVariablesInObjectWithLog
      }
    );
    results.push(checkResult);
  }
  
  // Summary
  const passed = results.filter(r => r.passed === true).length;
  const failed = results.filter(r => r.passed === false).length;
  const skipped = results.filter(r => r.skipped === true).length;
  const total = results.length;
  
  print(`\n${symbols.check} Check execution completed!`, 'green');
  print(`  Total: ${total} check(s)`, 'cyan');
  print(`  Passed: ${passed}`, passed === total ? 'green' : 'yellow');
  if (failed > 0) {
    print(`  Failed: ${failed}`, 'red');
  }
  if (skipped > 0) {
    print(`  Skipped: ${skipped}`, 'yellow');
  }
  
  log(`\n=== Check execution completed at ${new Date().toISOString()} ===\n`);
  
  // File logger uses append-only writes; no stream to close.
  
  process.exit(failed > 0 ? 1 : 0);
}

// NOTE: getDirectorySize/formatBytes were moved to ./install/installer-utils.ts

/**
 * Show installation status
 */
async function showStatus() {
  const { loadInstallState, getInstallStatePath } = await import('./install/install-state.js');
  
  // Check if install-state.json exists
  const statePath = getInstallStatePath(WORKSPACE_ROOT);
  if (!fs.existsSync(statePath)) {
    // If file doesn't exist, output empty string
    process.stdout.write('');
    process.exit(0);
  }
  
  try {
    // Read install-state.json
    const state = loadInstallState(WORKSPACE_ROOT);
    
    // If state is empty or couldn't be parsed, output empty string
    if (!state || Object.keys(state).length === 0) {
      process.stdout.write('');
      process.exit(0);
    }
    
    // Calculate .cache directory size
    const cacheSize = getDirectorySize(CACHE_DIR);
    const cacheSizeFormatted = formatBytes(cacheSize);
    
    // Output JSON with status and cache size
    const output = {
      status: state,
      cacheSize: cacheSize,
      cacheSizeFormatted: cacheSizeFormatted
    };
    
    process.stdout.write(JSON.stringify(output, null, 2));
    process.exit(0);
  } catch {
    // If there's an error reading the file, output empty string
    process.stdout.write('');
    process.exit(0);
  }
}

/**
 * Check if all required tokens are present
 */
function checkTokensOnly() {
  print(`\n${symbols.search} Checking required tokens...\n`, 'blue');
  
  // Read configuration
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${CONFIG_FILE}`, 'red');
    process.exit(1);
  }
  
  // Check if env section exists
  if (!config.env || !Array.isArray(config.env) || config.env.length === 0) {
    print(`${symbols.info} No environment variables defined in config`, 'cyan');
    process.exit(0);
  }
  
  // Read .env file
  const env = readEnvFile(ENV_FILE);
  
  let allPresent = true;
  const missing = [];
  const present = [];
  
  print(`\n${symbols.info} Checking ${config.env.length} token(s)...\n`, 'cyan');
  
  for (const envVar of config.env) {
    const key = envVar && typeof envVar === 'object' ? envVar.name : null;
    const comment = envVar && typeof envVar === 'object' ? (envVar.description || '') : '';

    if (!key) {
      print(`  ${symbols.warning} Skipping invalid env entry (missing name)`, 'yellow');
      log(`Skipping invalid env entry: ${JSON.stringify(envVar)}`);
      continue;
    }
    
    // Check in process.env first, then .env file
    const value = process.env[key] || env[key];
    
    if (value && value.trim() !== '') {
      print(`  ${symbols.success} ${key} - present`, 'green');
      present.push(key);
    } else {
      print(`  ${symbols.error} ${key} - missing${comment ? ` (${comment})` : ''}`, 'red');
      missing.push(key);
      allPresent = false;
    }
  }
  
  print(`\n${symbols.check} Token check completed!`, allPresent ? 'green' : 'yellow');
  print(`  Present: ${present.length}/${config.env.length}`, allPresent ? 'green' : 'yellow');
  
  if (missing.length > 0) {
    print(`  Missing: ${missing.join(', ')}`, 'red');
    print(`\n${symbols.info} Run 'node install.js' to set up missing tokens`, 'cyan');
  }
  
  process.exit(allPresent ? 0 : 1);
}

// NOTE: seed-files copy helpers were moved to ./install/installer-utils.ts

/**
 * Install workspace from scratch using 7-step process
 */
async function installWorkspace(): Promise<void> {
  // Ensure workspace directory exists
  if (!fs.existsSync(WORKSPACE_ROOT)) {
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  }
  
  // Read or create workspace config
  let config = readJSON(CONFIG_FILE);
  
  if (!config) {
    // Create new workspace config
    const modules = INSTALL_MODULES ? INSTALL_MODULES.split(',').map(m => m.trim()) : ['core', 'cursor'];
    
    // Calculate relative path from workspace to devduck project
    let devduckPath = path.relative(WORKSPACE_ROOT, PROJECT_ROOT);
    if (!devduckPath || devduckPath === '.') {
      devduckPath = './projects/devduck';
    } else if (!devduckPath.startsWith('.')) {
      devduckPath = './' + devduckPath;
    }
    
    config = {
      workspaceVersion: '0.1.0',
      devduckPath: devduckPath,
      modules: modules,
      moduleSettings: {},
      repos: [],
      projects: [],
      checks: [],
      env: []
    };
    
    // If workspace.config.json path was provided, read it and merge on top of defaults
    if (WORKSPACE_CONFIG_PATH && fs.existsSync(WORKSPACE_CONFIG_PATH)) {
      const providedWorkspaceConfig = readJSON(WORKSPACE_CONFIG_PATH);
      if (providedWorkspaceConfig) {
        config = { ...config, ...providedWorkspaceConfig };
        if (providedWorkspaceConfig.modules) {
          config.modules = providedWorkspaceConfig.modules;
        }

        // If seedFiles[] is provided, copy those paths from the provided config folder
        // into the newly created workspace root.
        // Backward compat: accept `files` as legacy field name.
        const seedFiles =
          (providedWorkspaceConfig as Record<string, unknown>).seedFiles ??
          (providedWorkspaceConfig as Record<string, unknown>).files;
        copySeedFilesFromProvidedWorkspaceConfig({
          workspaceRoot: WORKSPACE_ROOT,
          providedWorkspaceConfigPath: WORKSPACE_CONFIG_PATH,
          seedFiles,
          print,
          symbols,
          log
        });
      }
    }
    
    // If config file was provided, read it and merge
    if (CONFIG_FILE_PATH && fs.existsSync(CONFIG_FILE_PATH)) {
      const providedConfig = readJSON(CONFIG_FILE_PATH);
      if (providedConfig) {
        config = { ...config, ...providedConfig };
        if (providedConfig.modules) {
          config.modules = providedConfig.modules;
        }
      }
    }
    
    writeJSON(CONFIG_FILE, config);
    print(`\n${symbols.success} Created workspace.config.json`, 'green');
    log(`Created workspace.config.json with modules: ${config.modules.join(', ')}`);
  } else {
    // If a workspace config path is provided for an existing workspace, keep the existing one
    if (WORKSPACE_CONFIG_PATH) {
      print(`\n${symbols.info} workspace.config.json already exists, ignoring --workspace-config`, 'cyan');
      log(`workspace.config.json already exists at ${CONFIG_FILE}, ignoring --workspace-config=${WORKSPACE_CONFIG_PATH}`);
    }
    // Update existing config if modules specified
    if (INSTALL_MODULES) {
      const modules = INSTALL_MODULES.split(',').map(m => m.trim());
      config.modules = modules;
      writeJSON(CONFIG_FILE, config);
      print(`\n${symbols.info} Updated workspace.config.json with modules: ${modules.join(', ')}`, 'cyan');
      log(`Updated workspace.config.json with modules: ${modules.join(', ')}`);
    }
  }
  
  // Setup .env file from workspace config (before step 1)
  await setupEnvFile(WORKSPACE_ROOT, config as WorkspaceConfig, {
    autoYes: AUTO_YES,
    log,
    print,
    symbols
  });
  
  // Re-read config from file to ensure we have the latest version (including repos)
  const latestConfig = readJSON(CONFIG_FILE) || config;
  
  // Load module checks early (before generating mcp.json) to include their mcpSettings
  // This is needed for MCP generation before step 1
  let moduleChecks: Array<{ name?: string; mcpSettings?: Record<string, unknown> }> = [];
  try {
    const { getAllModules, resolveModules, loadModuleFromPath } = await import('./install/module-resolver.js');
    const { loadModulesFromRepo, getDevduckVersion } = await import('./lib/repo-modules.js');
    
    // Load local modules
    const allModules = getAllModules();
    const resolvedModules = resolveModules(latestConfig as WorkspaceConfig, allModules);
    moduleChecks = resolvedModules.flatMap(module => module.checks || []);
    
    // Also load modules from external repositories (for MCP generation only)
    const repos = (latestConfig as WorkspaceConfig).repos;
    if (repos && Array.isArray(repos) && repos.length > 0) {
      const devduckVersion = getDevduckVersion();
      for (const repoUrl of repos) {
        try {
          const repoModulesPath = await loadModulesFromRepo(repoUrl, WORKSPACE_ROOT, devduckVersion);
          if (fs.existsSync(repoModulesPath)) {
            const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
            for (const entry of repoModuleEntries) {
              if (entry.isDirectory()) {
                const modulePath = path.join(repoModulesPath, entry.name);
                const module = loadModuleFromPath(modulePath, entry.name);
                if (module && module.checks) {
                  moduleChecks.push(...module.checks);
                }
              }
            }
          }
        } catch (error) {
          // Continue with other repos
        }
      }
    }
  } catch (error) {
    // Continue without module checks - workspace config checks will still be used
  }
  
  // Generate mcp.json before step 1 (some checks may need MCP configuration)
  generateMcpJson(WORKSPACE_ROOT, { log, print, symbols, moduleChecks });
  
  // Use the unified runner for the step-based installer.
  const {
    installStep1CheckEnv,
    installStep2DownloadRepos,
    installStep3DownloadProjects,
    installStep4CheckEnvAgain,
    installStep5SetupModules,
    installStep6SetupProjects,
    installStep7VerifyInstallation
  } = await import('./install/index.js');

  const logger = installLogger ?? createInstallLogger(WORKSPACE_ROOT, { filePath: LOG_FILE });

  const ctx: InstallContext = {
    workspaceRoot: WORKSPACE_ROOT,
    projectRoot: PROJECT_ROOT,
    config: latestConfig,
    autoYes: AUTO_YES,
    logger
  };

  const steps: InstallStep[] = [
    {
      id: 'check-env',
      title: 'Check Environment Variables',
      description: 'Verify required env variables exist in config/modules/projects.',
      run: installStep1CheckEnv
    },
    {
      id: 'download-repos',
      title: 'Download Repositories',
      description: 'Clone or update external repositories under devduck/.',
      run: installStep2DownloadRepos
    },
    {
      id: 'download-projects',
      title: 'Download Projects',
      description: 'Clone or link projects into projects/.',
      run: installStep3DownloadProjects
    },
    {
      id: 'check-env-again',
      title: 'Check Environment Again',
      description: 'Re-check env after repos/projects are available.',
      run: installStep4CheckEnvAgain
    },
    {
      id: 'setup-modules',
      title: 'Setup Modules',
      description: 'Run module hooks and checks.',
      run: installStep5SetupModules
    },
    {
      id: 'setup-projects',
      title: 'Setup Projects',
      description: 'Run project checks and finalize setup.',
      run: installStep6SetupProjects
    },
    {
      id: 'verify-installation',
      title: 'Verify Installation',
      description: 'Run verification checks.',
      run: installStep7VerifyInstallation
    }
  ];

  const result = await runInstall(steps, ctx);
  if (result.status === 'paused') {
    print(`\n${symbols.warning} Installation paused: Please set missing environment variables and re-run`, 'yellow');
    return;
  }
  if (result.status === 'failed') {
    print(`\n${symbols.error} Installation failed: ${result.error}`, 'red');
    process.exit(1);
  }
  
  // Install project scripts to workspace package.json
  try {
    const { installProjectScripts } = await import('./install/install-project-scripts.js');
    print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
    log(`Installing project scripts to workspace package.json`);
    installProjectScripts(WORKSPACE_ROOT, config.projects || [], config, log);
    print(`  ${symbols.success} Project scripts installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install project scripts: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install project scripts: ${err.message}\n${err.stack}`);
  }

  // Install API script to workspace package.json
  try {
    const { installApiScript } = await import('./install/install-project-scripts.js');
    print(`\n${symbols.info} Installing API script to workspace package.json...`, 'cyan');
    log(`Installing API script to workspace package.json`);
    installApiScript(WORKSPACE_ROOT, log);
    print(`  ${symbols.success} API script installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install API script: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install API script: ${err.message}\n${err.stack}`);
  }
  
  // Create .cache/devduck directory
  const cacheDevduckDir = path.join(WORKSPACE_ROOT, '.cache', 'devduck');
  if (!fs.existsSync(cacheDevduckDir)) {
    fs.mkdirSync(cacheDevduckDir, { recursive: true });
  }
  
  print(`\n${symbols.success} Workspace installation completed!`, 'green');
  log(`Workspace installation completed at ${new Date().toISOString()}`);
}

/**
 * Main installation check function
 */
async function main(): Promise<void> {
  // If --status flag is set, show status and exit
  if (STATUS_ONLY) {
    await showStatus();
    return;
  }
  
  // If --check-tokens-only flag is set, only check tokens and exit
  if (CHECK_TOKENS_ONLY) {
    checkTokensOnly();
    return;
  }
  
  // If --test-checks is set, run only tests for selected checks
  if (TEST_CHECKS && TEST_CHECKS.length > 0) {
    await runSelectedChecks(TEST_CHECKS, true);
    return;
  }
  
  // If --checks is set, run checks with installation for selected checks
  if (CHECKS && CHECKS.length > 0) {
    await runSelectedChecks(CHECKS, false);
    return;
  }
  
  // If workspace-path is specified, install workspace from scratch
  if (WORKSPACE_PATH) {
    initLogging();
    print(`\n${symbols.search} Installing workspace...\n`, 'blue');
    await installWorkspace();
    process.exit(0);
  }
  
  // Initialize
  initLogging();
  
  print(`\n${symbols.search} Checking environment installation...\n`, 'blue');
  
  // Setup .env file if needed
  const configForEnv = readJSON(CONFIG_FILE);
  if (configForEnv) {
    await setupEnvFile(WORKSPACE_ROOT, configForEnv as WorkspaceConfig, {
      autoYes: AUTO_YES,
      log,
      print,
      symbols
    });
  }
  
  // Read configuration
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${CONFIG_FILE}`, 'red');
    log(`ERROR: Cannot read configuration file: ${CONFIG_FILE}`);
    process.exit(1);
  }
  
  log(`Configuration loaded from: ${CONFIG_FILE}`);
  
  // Load module checks early (before generating mcp.json) to include their mcpSettings
  let moduleChecks: Array<{ name?: string; mcpSettings?: Record<string, unknown> }> = [];
  try {
    const { getAllModules, resolveModules, loadModuleFromPath } = await import('./install/module-resolver.js');
    const { loadModulesFromRepo, getDevduckVersion } = await import('./lib/repo-modules.js');
    
    // Load local modules
    const allModules = getAllModules();
    const resolvedModules = resolveModules(config as WorkspaceConfig, allModules);
    moduleChecks = resolvedModules.flatMap(module => module.checks || []);
    
    // Also load modules from external repositories (for MCP generation only)
    const repos = (config as WorkspaceConfig).repos;
    if (repos && Array.isArray(repos) && repos.length > 0) {
      const devduckVersion = getDevduckVersion();
      for (const repoUrl of repos) {
        try {
          const repoModulesPath = await loadModulesFromRepo(repoUrl, WORKSPACE_ROOT, devduckVersion);
          if (fs.existsSync(repoModulesPath)) {
            const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
            for (const entry of repoModuleEntries) {
              if (entry.isDirectory()) {
                const modulePath = path.join(repoModulesPath, entry.name);
                const module = loadModuleFromPath(modulePath, entry.name);
                if (module && module.checks) {
                  moduleChecks.push(...module.checks);
                }
              }
            }
          }
        } catch (error) {
          // Continue with other repos
        }
      }
    }
  } catch (error) {
    // Continue without module checks
  }
  
  // Generate mcp.json
  const mcpServers = generateMcpJson(WORKSPACE_ROOT, { log, print, symbols, moduleChecks });
  
  // Check MCP servers if they were generated
  let mcpResults = [];
  if (mcpServers) {
    mcpResults = await checkMcpServers(mcpServers, WORKSPACE_ROOT, { log, print, symbols });
  }
  
  // Import step functions
  const { runStep1CheckEnv } = await import('./install/install-1-check-env.js');
  const { runStep2DownloadRepos } = await import('./install/install-2-download-repos.js');
  const { runStep3DownloadProjects } = await import('./install/install-3-download-projects.js');
  const { runStep4CheckEnvAgain } = await import('./install/install-4-check-env-again.js');
  const { runStep5SetupModules } = await import('./install/install-5-setup-modules.js');
  const { runStep6SetupProjects } = await import('./install/install-6-setup-projects.js');
  const { runStep7VerifyInstallation } = await import('./install/install-7-verify-installation.js');
  const { loadInstallState, saveInstallState } = await import('./install/install-state.js');
  
  // Step 1: Check environment variables
  const step1Result = await runStep1CheckEnv(WORKSPACE_ROOT, PROJECT_ROOT, log);
  if (step1Result.validationStatus === 'needs_input') {
    // Not a failure, but we must not continue with installation checks until tokens are provided.
    process.exit(0);
  }
  if (step1Result.validationStatus === 'failed') {
    process.exit(1);
  }
  
  // Step 2: Download repositories
  await runStep2DownloadRepos(WORKSPACE_ROOT, log);
  
  // Step 3: Download projects
  await runStep3DownloadProjects(WORKSPACE_ROOT, log);
  
  // Step 4: Check environment again
  const step4Result = await runStep4CheckEnvAgain(WORKSPACE_ROOT, PROJECT_ROOT, log);
  if (step4Result.validationStatus === 'needs_input') {
    process.exit(0);
  }
  if (step4Result.validationStatus === 'failed') {
    process.exit(1);
  }
  
  // Step 5: Setup modules
  const step5Result = await runStep5SetupModules(WORKSPACE_ROOT, PROJECT_ROOT, log, AUTO_YES);
  
  // Step 6: Setup projects
  const step6Result = await runStep6SetupProjects(WORKSPACE_ROOT, PROJECT_ROOT, log, AUTO_YES);
  
  // Step 7: Verify installation
  const step7Result = await runStep7VerifyInstallation(WORKSPACE_ROOT, PROJECT_ROOT, log, AUTO_YES);
  
  // Install project scripts to workspace package.json
  try {
    const { installProjectScripts } = await import('./install/install-project-scripts.js');
    print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
    log(`Installing project scripts to workspace package.json`);
    installProjectScripts(WORKSPACE_ROOT, config.projects || [], config, log);
    print(`  ${symbols.success} Project scripts installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install project scripts: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install project scripts: ${err.message}\n${err.stack}`);
  }

  // Install API script to workspace package.json
  try {
    const { installApiScript } = await import('./install/install-project-scripts.js');
    print(`\n${symbols.info} Installing API script to workspace package.json...`, 'cyan');
    log(`Installing API script to workspace package.json`);
    installApiScript(WORKSPACE_ROOT, log);
    print(`  ${symbols.success} API script installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install API script: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install API script: ${err.message}\n${err.stack}`);
  }
  
  // Collect results from all steps for summary
  const state = loadInstallState(WORKSPACE_ROOT);
  
  // Build installedModules map from step 5 results
  const installedModules: Record<string, string> = {};
  if (step5Result.modules) {
    for (const module of step5Result.modules) {
      if (module.name && module.path) {
        installedModules[module.name] = module.path;
      }
    }
  }
  
  // Update state with installed modules
  state.installedModules = installedModules;
  state.installedAt = new Date().toISOString();
  state.mcpServers = mcpResults;
  state.checks = step7Result.results;
  state.projects = step6Result.projects;
  saveInstallState(WORKSPACE_ROOT, state);
  
  // Summary
  const allChecks = step7Result.results;
  const checksPassed = allChecks.filter(c => c.passed === true).length;
  const checksSkipped = allChecks.filter(c => c.skipped === true).length;
  const checksTotal = allChecks.length;
  
  // Calculate MCP statistics
  let mcpWorking = 0;
  let mcpTotal = 0;
  let mcpOptionalFailed = 0;
  if (mcpResults && Array.isArray(mcpResults)) {
    mcpTotal = mcpResults.length;
    mcpWorking = mcpResults.filter((m: { working?: boolean }) => m.working).length;
    mcpOptionalFailed = mcpResults.filter((m: { working?: boolean; optional?: boolean }) => !m.working && m.optional).length;
  }
  
  const mcpRequiredTotal = mcpResults ? mcpResults.filter((m: { optional?: boolean }) => !m.optional).length : 0;
  const mcpRequiredWorking = mcpResults ? mcpResults.filter((m: { working?: boolean; optional?: boolean }) => !m.optional && m.working).length : 0;
  
  // Calculate project statistics
  const projectsTotal = step6Result.projects ? step6Result.projects.length : 0;
  const projectsWithSymlink = step6Result.projects ? step6Result.projects.filter(p => p.symlink && !p.symlink.error).length : 0;
  let projectChecksPassed = 0;
  let projectChecksTotal = 0;
  let projectChecksSkipped = 0;
  if (step6Result.projects) {
    for (const project of step6Result.projects) {
      if (project.checks) {
        projectChecksTotal += project.checks.length;
        projectChecksPassed += project.checks.filter(c => c.passed === true).length;
        projectChecksSkipped += project.checks.filter(c => c.skipped === true).length;
      }
    }
  }
  
  print(`\n${symbols.check} Installation check completed!`, 'green');
  const checksRan = checksTotal - checksSkipped;
  let checksMsg = `  Checks: ${checksPassed}/${checksRan} passed`;
  if (checksSkipped > 0) {
    checksMsg += ` (${checksSkipped} skipped)`;
  }
  const checksColor = checksPassed === checksRan ? 'green' : 'red';
  print(checksMsg, checksColor);
  if (checksPassed !== checksRan) {
    print(`  ${symbols.error} Some checks failed. Please review the output above.`, 'red');
  }
  if (mcpTotal > 0) {
    if (mcpRequiredTotal > 0) {
      const mcpStatus = mcpRequiredWorking === mcpRequiredTotal ? 'green' : 'yellow';
      let mcpMsg = `  MCP Servers: ${mcpRequiredWorking}/${mcpRequiredTotal} required working`;
      if (mcpOptionalFailed > 0) {
        mcpMsg += ` (${mcpOptionalFailed} optional failed)`;
      }
      print(mcpMsg, mcpStatus);
    } else if (mcpOptionalFailed > 0) {
      print(`  MCP Servers: ${mcpWorking}/${mcpTotal} working (${mcpOptionalFailed} optional failed)`, 'yellow');
    } else {
      print(`  MCP Servers: ${mcpWorking}/${mcpTotal} working`, 'green');
    }
  }
  if (projectsTotal > 0) {
    print(`  Projects: ${projectsWithSymlink}/${projectsTotal} linked`, 
      projectsWithSymlink === projectsTotal ? 'green' : 'red');
    if (projectChecksTotal > 0) {
      const projectChecksRan = projectChecksTotal - projectChecksSkipped;
      let projectChecksMsg = `  Project checks: ${projectChecksPassed}/${projectChecksRan} passed`;
      if (projectChecksSkipped > 0) {
        projectChecksMsg += ` (${projectChecksSkipped} skipped)`;
      }
      print(projectChecksMsg, projectChecksPassed === projectChecksRan ? 'green' : 'yellow');
    }
  }
  print(`\n${symbols.file} Results saved to .cache/install-state.json`, 'cyan');
  print(`${symbols.log} Logs written to .cache/install.log\n`, 'cyan');
  
  log(`\n=== Installation check completed at ${new Date().toISOString()} ===\n`);
  
  // Exit with error code if something failed
  const mcpRequiredFailed = mcpResults ? mcpResults.filter((m: { working?: boolean; optional?: boolean }) => !m.optional && !m.working).length : 0;
  const checksFailed = allChecks.filter(c => c.passed === false).length;
  const hasFailures = checksFailed > 0 || mcpRequiredFailed > 0;
  
  // Logger uses append-only writes; no stream to close.
  
  if (hasFailures) {
    process.exit(1);
  }
}

// Run main function
main().catch(async (error) => {
  const err = error as Error;
  print(`\n${symbols.error} Fatal error: ${err.message}`, 'red');
    log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
