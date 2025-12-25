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
const CACHE_FILE = path.join(CACHE_DIR, 'install-check.json');
const LOG_FILE = path.join(CACHE_DIR, 'install.log');
const ENV_FILE = path.join(WORKSPACE_ROOT, '.env');
const CURSOR_DIR = path.join(WORKSPACE_ROOT, '.cursor');
const MCP_FILE = path.join(CURSOR_DIR, 'mcp.json');
const PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'projects');

// Tier execution order
const TIER_ORDER = ['pre-install', 'install', 'live', 'pre-test', 'tests'];
const DEFAULT_TIER = 'pre-install';

// Log file stream
let logStream: fs.WriteStream | null = null;

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
  
  // Open log file (overwrite on each run)
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  
  log(`\n=== Installation check started at ${new Date().toISOString()} ===\n`);
}

/**
 * Write to log file
 */
function log(message: string): void {
  const timestamp = new Date().toISOString();
  if (logStream) {
    logStream.write(`[${timestamp}] ${message}\n`);
  }
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

/**
 * Check if check string is a file path (not a command)
 */
function isFilePath(check: string | undefined): boolean {
  if (!check) return false;
  
  // Remove leading/trailing whitespace
  const trimmed = check.trim();
  
  // If contains spaces, it's likely a command
  if (trimmed.includes(' ')) return false;
  
  // If contains command operators, it's a command
  if (trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes(';') || trimmed.includes('|')) {
    return false;
  }
  
  // If starts with / or ~, it's likely a file path
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return true;
  }
  
  // If contains / and no spaces, it might be a relative path
  if (trimmed.includes('/') && !trimmed.includes(' ')) {
    return true;
  }
  
  return false;
}

interface FileCheckResult {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
  error?: string;
}

/**
 * Check if file or directory exists
 */
function checkFileExists(filePath: string): FileCheckResult {
  try {
    // Expand ~ to home directory
    const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
    
    // Resolve relative paths
    const resolvedPath = path.isAbsolute(expandedPath) 
      ? expandedPath 
      : path.resolve(PROJECT_ROOT, expandedPath);
    
    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        path: resolvedPath
      };
    }
    
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      path: resolvedPath
    };
  } catch (error) {
    const err = error as Error;
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      path: filePath,
      error: err.message
    };
  }
}

/**
 * Get project name from `src`
 * e.g., "crm/frontend/services/shell" -> "shell"
 * e.g., "github.com/holiber/devduck" -> "devduck"
 * e.g., "arc://junk/user/project" -> "project"
 */
function getProjectName(src: string | undefined): string {
  if (!src) return 'unknown';
  
  // Handle arc:// URLs
  if (src.startsWith('arc://')) {
    const pathPart = src.replace('arc://', '');
    return path.basename(pathPart);
  }
  
  // Handle GitHub URLs
  if (src.includes('github.com/')) {
    const match = src.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match) {
      return match[1].replace('.git', '');
    }
  }
  
  // Handle regular paths
  return path.basename(src);
}

interface SymlinkResult {
  success: boolean;
  path: string;
  target: string;
  existed?: boolean;
  created?: boolean;
  error?: string;
}

/**
 * Create symlink in projects/ pointing directly to a target folder.
 * Used for local-folder projects (project.src is a directory path).
 */
function createProjectSymlinkToTarget(projectName: string, targetPath: string): SymlinkResult {
  const symlinkPath = path.join(PROJECTS_DIR, projectName);
  const resolvedTarget = path.resolve(targetPath);
  
  try {
    // Check if symlink already exists
    if (fs.existsSync(symlinkPath)) {
      if (fs.lstatSync(symlinkPath).isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(symlinkPath);
        // readlink may return relative paths; normalize before comparing
        const existingResolved = path.resolve(path.dirname(symlinkPath), existingTarget);
        if (existingResolved === resolvedTarget) {
          log(`Symlink already exists and points to correct target: ${symlinkPath} -> ${resolvedTarget}`);
          return { success: true, path: symlinkPath, target: resolvedTarget, existed: true };
        }
        fs.unlinkSync(symlinkPath);
        log(`Removed old symlink: ${symlinkPath} (was pointing to ${existingTarget})`);
      } else {
        // It's a directory or file, remove it
        fs.rmSync(symlinkPath, { recursive: true, force: true });
        log(`Removed existing path: ${symlinkPath}`);
      }
    }
    
    if (!fs.existsSync(resolvedTarget)) {
      log(`Target path does not exist: ${resolvedTarget}`);
      return { success: false, path: symlinkPath, target: resolvedTarget, error: 'Target path does not exist' };
    }
    
    const stats = fs.statSync(resolvedTarget);
    if (!stats.isDirectory()) {
      log(`Target path is not a directory: ${resolvedTarget}`);
      return { success: false, path: symlinkPath, target: resolvedTarget, error: 'Target path is not a directory' };
    }
    
    fs.symlinkSync(resolvedTarget, symlinkPath);
    log(`Created symlink: ${symlinkPath} -> ${resolvedTarget}`);
    return { success: true, path: symlinkPath, target: resolvedTarget, created: true };
  } catch (error) {
    const err = error as Error;
    log(`Error creating symlink: ${err.message}`);
    return { success: false, path: symlinkPath, target: resolvedTarget, error: err.message };
  }
}

function resolveProjectSrcToWorkspacePath(projectSrc: string | undefined): string | null {
  if (!projectSrc || typeof projectSrc !== 'string') return null;
  // Treat relative paths as relative to the workspace root (not PROJECT_ROOT)
  return path.isAbsolute(projectSrc) ? projectSrc : path.resolve(WORKSPACE_ROOT, projectSrc);
}

function isExistingDirectory(dirPath: string | undefined): boolean {
  try {
    if (!dirPath) return false;
    if (!fs.existsSync(dirPath)) return false;
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create symlink for a project
 */
function createProjectSymlink(projectName: string, pathInArcadia: string, env: Record<string, string>): SymlinkResult {
  const symlinkPath = path.join(PROJECTS_DIR, projectName);
  
  // Get ARCADIA path from env
  let arcadiaPath = env.ARCADIA || process.env.ARCADIA || '~/arcadia';
  arcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');
  
  const targetPath = path.join(arcadiaPath, pathInArcadia);
  
  try {
    // Check if symlink already exists
    if (fs.existsSync(symlinkPath)) {
      // Check if it's a symlink
      if (fs.lstatSync(symlinkPath).isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(symlinkPath);
        if (existingTarget === targetPath) {
          log(`Symlink already exists and points to correct target: ${symlinkPath} -> ${targetPath}`);
          return { success: true, path: symlinkPath, target: targetPath, existed: true };
        } else {
          // Remove old symlink
          fs.unlinkSync(symlinkPath);
          log(`Removed old symlink: ${symlinkPath} (was pointing to ${existingTarget})`);
        }
      } else {
        // It's a directory, remove it
        fs.rmSync(symlinkPath, { recursive: true, force: true });
        log(`Removed existing directory: ${symlinkPath}`);
      }
    }
    
    // Check if target exists
    if (!fs.existsSync(targetPath)) {
      log(`Target path does not exist: ${targetPath}`);
      return { success: false, path: symlinkPath, target: targetPath, error: 'Target path does not exist' };
    }
    
    // Create symlink
    fs.symlinkSync(targetPath, symlinkPath);
    log(`Created symlink: ${symlinkPath} -> ${targetPath}`);
    
    return { success: true, path: symlinkPath, target: targetPath, created: true };
  } catch (error) {
    const err = error as Error;
    log(`Error creating symlink: ${err.message}`);
    return { success: false, path: symlinkPath, target: targetPath, error: err.message };
  }
}

/**
 * Check if test string is an HTTP request (format: "GET https://..." or "POST https://...")
 */
function isHttpRequest(test: string | undefined): boolean {
  if (!test) return false;
  const trimmed = test.trim();
  return /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+https?:\/\//i.test(trimmed);
}

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
      
      const fileCheck = checkFileExists(testWithVars);
      
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
            
            const recheckFile = checkFileExists(testWithVars);
            
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


// checkCommandExists is still used by checks, will be moved when extracting checks
interface CommandCheckResult {
  exists: boolean;
  executable: boolean;
  path?: string;
  error?: string;
}

/**
 * Check if file/command exists and is executable
 */
function checkCommandExists(commandPath: string): CommandCheckResult {
  try {
    // Get just the command name (first part before space)
    const commandName = commandPath.split(/\s+/)[0];
    
    // Expand ~ to home directory
    const expandedPath = commandName.replace(/^~/, process.env.HOME || '');
    
    // Check if it's an absolute path
    if (path.isAbsolute(expandedPath)) {
      if (fs.existsSync(expandedPath)) {
        // Check if it's executable
        try {
          fs.accessSync(expandedPath, fs.constants.F_OK | fs.constants.X_OK);
          return { exists: true, executable: true };
        } catch {
          return { exists: true, executable: false };
        }
      }
      return { exists: false, executable: false };
    }
    
    // For commands in PATH, use 'which' or 'command -v'
    try {
      // Try 'command -v' first (POSIX compliant)
      const whichResult = executeCommand(`command -v ${expandedPath}`);
      if (whichResult.success && whichResult.output) {
        return { exists: true, executable: true, path: whichResult.output };
      }
      
      // Fallback to 'which' if available
      const whichResult2 = executeCommand(`which ${expandedPath}`);
      if (whichResult2.success && whichResult2.output) {
        return { exists: true, executable: true, path: whichResult2.output };
      }
      
      return { exists: false, executable: false };
    } catch (error) {
      const err = error as Error;
      return { exists: false, executable: false, error: err.message };
    }
  } catch (error) {
    const err = error as Error;
    return { exists: false, executable: false, error: err.message };
  }
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

interface Project {
  src?: string;
  path_in_arcadia?: string;
  checks?: CheckItem[];
  [key: string]: unknown;
}

interface ProjectResult {
  name: string;
  src: string | undefined;
  symlink: SymlinkResult | null;
  checks: CheckResult[];
}

/**
 * Create symlink for a project and return initial result object
 */
function initProjectResult(project: Project, env: Record<string, string>): ProjectResult {
  const projectName = getProjectName(project.src);
  
  print(`\n${symbols.info} Processing project: ${projectName}`, 'cyan');
  log(`Processing project: ${projectName} (${project.src})`);
  
  const result = {
    name: projectName,
    src: project.src,
    symlink: null,
    checks: []
  };

  if (!project.src || typeof project.src !== 'string') {
    print(`  ${symbols.warning} Project is missing required field: src`, 'yellow');
    log(`Project skipped: missing src field (${JSON.stringify(project)})`);
    result.symlink = {
      path: null,
      target: null,
      error: 'Missing required field: src'
    };
    return result;
  }
  
  // Arcadia projects: create symlink into Arcadia checkout.
  // GitHub projects don't need symlinks in workspace.
  if (project.src.startsWith('arc://')) {
    print(`  Creating symlink...`, 'cyan');
    // Remove arc:// prefix if present
    const pathForSymlink = project.src.replace(/^arc:\/\//, '');
    const symlinkResult = createProjectSymlink(projectName, pathForSymlink, env);
    
    if (symlinkResult.success) {
      const action = symlinkResult.existed ? 'exists' : 'created';
      print(`  ${symbols.success} Symlink ${action}: projects/${projectName} -> ${symlinkResult.target}`, 'green');
      result.symlink = {
        path: `projects/${projectName}`,
        target: symlinkResult.target,
        created: symlinkResult.created || false
      };
    } else {
      print(`  ${symbols.error} Symlink failed: ${symlinkResult.error}`, 'red');
      result.symlink = {
        path: `projects/${projectName}`,
        target: symlinkResult.target,
        error: symlinkResult.error
      };
    }
  } else if (project.src && isExistingDirectory(resolveProjectSrcToWorkspacePath(project.src))) {
    // Local-folder projects - create symlink in projects/ directly to the folder path
    const resolvedLocalPath = resolveProjectSrcToWorkspacePath(project.src);
    print(`  Creating symlink...`, 'cyan');
    const symlinkResult = createProjectSymlinkToTarget(projectName, resolvedLocalPath);
    
    if (symlinkResult.success) {
      const action = symlinkResult.existed ? 'exists' : 'created';
      print(`  ${symbols.success} Symlink ${action}: projects/${projectName} -> ${symlinkResult.target}`, 'green');
      result.symlink = {
        path: `projects/${projectName}`,
        target: symlinkResult.target,
        created: symlinkResult.created || false
      };
    } else {
      print(`  ${symbols.error} Symlink failed: ${symlinkResult.error}`, 'red');
      result.symlink = {
        path: `projects/${projectName}`,
        target: symlinkResult.target,
        error: symlinkResult.error
      };
    }
    
    return result;
  } else if (project.src && (project.src.includes('github.com') || project.src.startsWith('git@'))) {
    // GitHub projects - clone to projects/ directory
    const projectPath = path.join(PROJECTS_DIR, projectName);
    
    // Check if already cloned
    if (fs.existsSync(projectPath) && fs.existsSync(path.join(projectPath, '.git'))) {
      // Update existing clone
      print(`  ${symbols.info} Updating existing git repository...`, 'cyan');
      log(`Updating existing git repository: ${projectPath}`);
      const pullResult = spawnSync('git', ['pull'], {
        cwd: projectPath,
        encoding: 'utf8'
      });
      
      if (pullResult.status === 0) {
        print(`  ${symbols.success} Repository updated: projects/${projectName}`, 'green');
        log(`Repository updated successfully: ${projectPath}`);
      } else {
        print(`  ${symbols.warning} Failed to update repository, using existing version`, 'yellow');
        log(`Failed to update repository: ${pullResult.stderr || pullResult.stdout}`);
      }
      
      result.symlink = {
        path: `projects/${projectName}`,
        target: projectPath,
        exists: true,
        updated: pullResult.status === 0
      };
    } else {
      // Clone repository
      print(`  ${symbols.info} Cloning repository...`, 'cyan');
      log(`Cloning repository: ${project.src} to ${projectPath}`);
      
      // Convert github.com/user/repo to https://github.com/user/repo.git
      // Use HTTPS for CI compatibility (no SSH keys required)
      let gitUrl = project.src;
      if (gitUrl.includes('github.com') && !gitUrl.startsWith('git@') && !gitUrl.startsWith('http')) {
        gitUrl = `https://github.com/${gitUrl.replace(/^github\.com\//, '').replace(/\.git$/, '')}.git`;
      }
      
      // Ensure projects directory exists
      if (!fs.existsSync(PROJECTS_DIR)) {
        fs.mkdirSync(PROJECTS_DIR, { recursive: true });
      }
      
      const cloneResult = spawnSync('git', ['clone', gitUrl, projectPath], {
        encoding: 'utf8',
        stdio: 'inherit'
      });
      
      if (cloneResult.status === 0) {
        print(`  ${symbols.success} Repository cloned: projects/${projectName}`, 'green');
        log(`Repository cloned successfully: ${projectPath}`);
        result.symlink = {
          path: `projects/${projectName}`,
          target: projectPath,
          created: true
        };
      } else {
        print(`  ${symbols.error} Failed to clone repository: ${cloneResult.stderr || cloneResult.stdout}`, 'red');
        log(`Failed to clone repository: ${cloneResult.stderr || cloneResult.stdout}`);
        result.symlink = {
          path: `projects/${projectName}`,
          target: projectPath,
          error: `Failed to clone: ${cloneResult.stderr || cloneResult.stdout}`
        };
      }
    }
  } else {
    // Other project types - no action needed
    print(`  ${symbols.info} Project type not supported for automatic setup`, 'cyan');
    result.symlink = {
      path: null,
      target: null,
      note: 'Project type not supported for automatic setup'
    };
  }
  
  return result;
}

/**
 * Get checks for a project grouped by tier
 */
function getProjectChecksByTier(project: Project, env: Record<string, string>): Record<string, CheckItem[]> {
  if (!project.checks || project.checks.length === 0) {
    return {};
  }
  
  const projectName = getProjectName(project.src);
  const checksWithVars = replaceVariablesInObjectWithLog(project.checks, env);
  
  const checksByTier = {};
  for (const check of checksWithVars) {
    const tier = check.tier || DEFAULT_TIER;
    if (!checksByTier[tier]) {
      checksByTier[tier] = [];
    }
    checksByTier[tier].push({
      ...check,
      _projectName: projectName
    });
  }
  
  return checksByTier;
}

/**
 * Run a single check and return result
 */
async function runCheck(check: CheckItem, projectName: string | undefined): Promise<CheckResult> {
  // Skip check if skip=true in config
  if (check.skip === true) {
    const prefix = projectName ? `[${projectName}] ` : '';
    print(`  ${symbols.warning} ${prefix}${check.name}: skipped`, 'yellow');
    log(`${prefix}CHECK SKIPPED: ${check.name}`);
    return {
      name: check.name,
      description: check.description || '',
      passed: null,
      skipped: true
    };
  }
  
  // Use unified processCheck function
  const checkResult = await processCheck(
    'project',
    projectName,
    check,
    {
      workspaceRoot: WORKSPACE_ROOT,
      checkCommand,
      checkHttpAccess,
      isHttpRequest,
      replaceVariablesInObjectWithLog
    }
  );
  return checkResult;
}

/**
 * Process all projects - create symlinks first, then run checks by tier across all projects
 */
async function processProjects(projects: Project[], env: Record<string, string>): Promise<ProjectResult[]> {
  if (!projects || projects.length === 0) {
    return [];
  }
  
  print(`\n${symbols.info} Processing projects...`, 'cyan');
  log(`Processing ${projects.length} projects`);
  
  // Ensure projects directory exists
  if (!fs.existsSync(PROJECTS_DIR)) {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    log(`Created projects directory: ${PROJECTS_DIR}`);
  }
  
  // Step 1: Create symlinks for all projects and initialize result objects
  const results = [];
  const projectChecksByTier = [];
  
  for (const project of projects) {
    const result = initProjectResult(project, env);
    results.push(result);
    projectChecksByTier.push({
      projectName: result.name,
      checksByTier: getProjectChecksByTier(project, env),
      resultRef: result
    });
  }
  
  // Step 2: Run checks tier by tier across all projects
  for (const tier of TIER_ORDER) {
    // Collect all checks for this tier across all projects
    const tierHasChecks = projectChecksByTier.some(p => 
      p.checksByTier[tier] && p.checksByTier[tier].length > 0
    );
    
    if (!tierHasChecks) {
      continue;
    }
    
    print(`\n${symbols.info} [${tier}] Running checks...`, 'cyan');
    log(`Tier: ${tier} - running checks for all projects`);
    
    for (const projectData of projectChecksByTier) {
      const tierChecks = projectData.checksByTier[tier];
      if (!tierChecks || tierChecks.length === 0) {
        continue;
      }
      
      log(`[${projectData.projectName}] Tier: ${tier} - ${tierChecks.length} check(s)`);
      
      for (const check of tierChecks) {
        const checkResult = await runCheck(check, projectData.projectName);
        checkResult.tier = tier;
        projectData.resultRef.checks.push(checkResult);
      }
    }
  }
  
  return results;
}

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
  
  // Close log stream
  if (logStream) {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Calculate directory size recursively
 */
function getDirectorySize(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }
    
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }
    
    let size = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirectorySize(entryPath);
      } else {
        try {
          const fileStats = fs.statSync(entryPath);
          size += fileStats.size;
      } catch {
        // Skip files that can't be accessed
        continue;
      }
      }
    }
    
    return size;
  } catch {
    return 0;
  }
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Show installation status
 */
function showStatus() {
  // Check if install-check.json exists
  if (!fs.existsSync(CACHE_FILE)) {
    // If file doesn't exist, output empty string
    process.stdout.write('');
    process.exit(0);
  }
  
  try {
    // Read install-check.json
    const statusData = readJSON(CACHE_FILE);
    
    // If file is empty or couldn't be parsed, output empty string
    if (!statusData) {
      process.stdout.write('');
      process.exit(0);
    }
    
    // Calculate .cache directory size
    const cacheSize = getDirectorySize(CACHE_DIR);
    const cacheSizeFormatted = formatBytes(cacheSize);
    
    // Output JSON with status and cache size
    const output = {
      status: statusData,
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

function isSafeRelativePath(p: string): boolean {
  const normalized = path.normalize(p);
  if (!normalized || normalized.trim() === '') return false;
  if (path.isAbsolute(normalized)) return false;
  // Block path traversal outside the base directory/workspace root
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return false;
  return true;
}

function copySeedFilesFromProvidedWorkspaceConfig(params: {
  workspaceRoot: string;
  providedWorkspaceConfigPath: string;
  seedFiles: unknown;
}): void {
  const { workspaceRoot, providedWorkspaceConfigPath, seedFiles } = params;

  if (!Array.isArray(seedFiles) || seedFiles.length === 0) return;

  const sourceRoot = path.dirname(providedWorkspaceConfigPath);

  print(`\n${symbols.info} Copying seed files into workspace...`, 'cyan');
  log(`Copying ${seedFiles.length} seed file(s) from ${sourceRoot} into ${workspaceRoot}`);

  for (const entry of seedFiles) {
    if (typeof entry !== 'string') {
      print(`  ${symbols.warning} Skipping non-string entry in seedFiles[]`, 'yellow');
      log(`Skipping non-string entry in seedFiles[]: ${JSON.stringify(entry)}`);
      continue;
    }

    const relPath = entry.trim();
    if (!isSafeRelativePath(relPath)) {
      print(`  ${symbols.warning} Skipping unsafe path in seedFiles[]: ${entry}`, 'yellow');
      log(`Skipping unsafe path in seedFiles[]: ${entry}`);
      continue;
    }

    const srcPath = path.join(sourceRoot, relPath);
    const destPath = path.join(workspaceRoot, relPath);

    try {
      if (!fs.existsSync(srcPath)) {
        print(`  ${symbols.warning} Missing seed path: ${relPath}`, 'yellow');
        log(`Seed path does not exist: ${srcPath}`);
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(srcPath, destPath, { recursive: true, force: true });
      print(`  ${symbols.success} Copied: ${relPath}`, 'green');
      log(`Copied seed path: ${srcPath} -> ${destPath}`);
    } catch (error) {
      const err = error as Error;
      print(`  ${symbols.warning} Failed to copy ${relPath}: ${err.message}`, 'yellow');
      log(`Failed to copy seed path ${srcPath} -> ${destPath}: ${err.message}`);
    }
  }
}

/**
 * Install workspace from scratch
 */
async function installWorkspace(): Promise<void> {
  const { loadModulesForWorkspace } = await import('./install/module-loader.js');
  const { executeHooksForStage, createHookContext } = await import('./install/module-hooks.js');
  
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
          seedFiles
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
  
  // Setup .env file from workspace config (before pre-install checks so modules can add vars)
  await setupEnvFile(WORKSPACE_ROOT, config as WorkspaceConfig, {
    autoYes: AUTO_YES,
    log,
    print,
    symbols
  });
  
  // Run pre-install checks (verify tokens before installing modules)
  // Note: Pre-install checks can also set environment variables via install commands
  print(`\n${symbols.info} Running pre-install checks...`, 'cyan');
  log(`Running pre-install checks`);
  try {
    const { runPreInstallChecks, validatePreInstallChecks } = await import('./install/pre-install-check.js');
    const checkResults = await runPreInstallChecks(WORKSPACE_ROOT);
    const validation = validatePreInstallChecks(checkResults, { print, log, symbols });
    if (validation === 'needs_input') {
      // Not a failure, but we must not continue workspace installation until tokens are provided.
      return;
    }
    if (validation === 'failed') {
      process.exit(1);
    }
  } catch (error) {
    const err = error as Error;
    print(`\n${symbols.error} Pre-install check error: ${err.message}`, 'red');
    log(`Pre-install check error: ${err.message}\n${err.stack}`);
    process.exit(1);
  }
  
  // Load modules from external repositories if specified
  const externalModules = [];
  if (config.repos && config.repos.length > 0) {
    print(`\n${symbols.info} Loading modules from external repositories...`, 'cyan');
    log(`Loading modules from ${config.repos.length} repository/repositories`);
    
    const { loadModulesFromRepo, getDevduckVersion } = await import('./lib/repo-modules.js');
    const { loadModule } = await import('./install/module-resolver.js');
    const devduckVersion = getDevduckVersion();
    
      for (const repoUrl of config.repos) {
        try {
          print(`  Loading modules [${repoUrl}]...`, 'cyan');
          log(`Loading modules from repository: ${repoUrl}`);
          const repoModulesPath = await loadModulesFromRepo(repoUrl, WORKSPACE_ROOT, devduckVersion);
        
        // repoModulesPath is the path to modules directory
        // Load modules from the repository
        if (fs.existsSync(repoModulesPath)) {
          const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
          const { loadModuleFromPath } = await import('./install/module-resolver.js');
          
          for (const entry of repoModuleEntries) {
            if (entry.isDirectory()) {
              const modulePath = path.join(repoModulesPath, entry.name);
              const module = loadModuleFromPath(modulePath, entry.name);
              
              if (module && module.name) {
                externalModules.push({
                  name: module.name,
                  version: module.version || '0.1.0',
                  description: module.description || '',
                  tags: module.tags || [],
                  dependencies: module.dependencies || [],
                  defaultSettings: module.defaultSettings || {},
                  path: module.path
                });
                print(`  ${symbols.success} Loaded external module: ${module.name}`, 'green');
                log(`Loaded external module: ${module.name} from ${repoUrl}`);
              } else if (module) {
                // Module loaded but no name - use directory name
                externalModules.push({
                  name: entry.name,
                  version: module.version || '0.1.0',
                  description: module.description || '',
                  tags: module.tags || [],
                  dependencies: module.dependencies || [],
                  defaultSettings: module.defaultSettings || {},
                  path: module.path
                });
                print(`  ${symbols.success} Loaded external module: ${entry.name}`, 'green');
                log(`Loaded external module: ${entry.name} from ${repoUrl}`);
              }
            }
          }
        }
      } catch (error) {
        const err = error as Error;
        print(`  ${symbols.warning} Failed to load modules from ${repoUrl}: ${err.message}`, 'yellow');
        log(`Failed to load modules from ${repoUrl}: ${err.message}`);
      }
    }
  }
  
  // Merge modules with explicit priority:
  // 1) workspace modules (<workspace>/modules)
  // 2) project modules (<workspace>/projects/*/modules)
  // 3) external repos (cloned into <workspace>/devduck/*)
  // 4) built-in devduck modules (this repo)
  const { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies, mergeModuleSettings } = await import('./install/module-resolver.js');
  const localModules = getAllModules();
  
  // Also load workspace-local modules (if workspace has its own modules/ folder)
  // Workspace modules should take precedence over built-in and external modules when names collide.
  const workspaceModulesDir = path.join(WORKSPACE_ROOT, 'modules');
  const workspaceModules = getAllModulesFromDirectory(workspaceModulesDir);
  
  // Also load modules from projects (if projects have modules/ folders)
  const projectsModules: Module[] = [];
  if (config.projects && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      const projectName = project.src.split('/').pop()?.replace(/\.git$/, '') || '';
      const projectPath = path.join(WORKSPACE_ROOT, 'projects', projectName);
      const projectModulesDir = path.join(projectPath, 'modules');
      if (fs.existsSync(projectModulesDir)) {
        const projectModules = getAllModulesFromDirectory(projectModulesDir);
        projectsModules.push(...projectModules);
        log(`Loaded ${projectModules.length} module(s) from project ${projectName}`);
      }
    }
  }
  
  const allModules = [...workspaceModules, ...projectsModules, ...externalModules, ...localModules];
  
  // Resolve modules manually with merged list (supports patterns like "issue-*")
  const moduleNames = expandModuleNames(config.modules || ['*'], allModules);
  const resolvedModules = resolveDependencies(moduleNames, allModules);
  
  // Load module resources
  const { loadModuleResources } = await import('./install/module-loader.js');
  const loadedModules = resolvedModules.map(module => {
    const resources = loadModuleResources(module);
    const mergedSettings = mergeModuleSettings(module, config.moduleSettings);
    
    return {
      ...resources,
      settings: mergedSettings
    };
  });

  // Persist installed module paths for downstream tooling.
  // This file is also used by `--status`.
  try {
    const installedModules: Record<string, string> = {};
    for (const m of loadedModules) {
      if (m && typeof m.name === 'string' && typeof m.path === 'string') {
        installedModules[m.name] = m.path;
      }
    }
    writeJSON(CACHE_FILE, {
      installedAt: new Date().toISOString(),
      installedModules
    });
    log(`Saved installed module paths to: ${CACHE_FILE}`);
  } catch (e) {
    const err = e as Error;
    log(`Failed to write ${CACHE_FILE}: ${err.message}`);
  }
  
  print(
    `\n${symbols.info} Loaded ${loadedModules.length} module(s) ` +
    `(${workspaceModules.length} workspace, ${projectsModules.length} projects, ${externalModules.length} external, ${localModules.length} devduck)`,
    'cyan'
  );
  log(`Loaded modules: ${loadedModules.map(m => m.name).join(', ')}`);
  // Debug logging for test mode
  if (process.env.NODE_ENV === 'test') {
    log(`[DEBUG] Module paths: ${loadedModules.map(m => `${m.name} -> ${m.path}`).join(', ')}`);
  }
  
  // Execute module hooks
  print(`\n${symbols.info} Executing module hooks...`, 'cyan');
  
  // Pre-install hooks
  const preInstallContexts = loadedModules.map(module => 
    createHookContext(WORKSPACE_ROOT, module, loadedModules)
  );
  await executeHooksForStage(loadedModules, 'pre-install', preInstallContexts);
  
  // Install hooks
  const installContexts = loadedModules.map(module => 
    createHookContext(WORKSPACE_ROOT, module, loadedModules)
  );
  await executeHooksForStage(loadedModules, 'install', installContexts);
  
  // Post-install hooks (this is where cursor module copies commands and rules)
  const postInstallContexts = loadedModules.map(module => 
    createHookContext(WORKSPACE_ROOT, module, loadedModules)
  );
  const postInstallResults = await executeHooksForStage(loadedModules, 'post-install', postInstallContexts);
  
  // Log results and check for failures
  let postInstallFailed = false;
  for (const result of postInstallResults) {
    if (result.success && result.message) {
      log(`Module ${result.module}: ${result.message}`);
    } else if (!result.success) {
      postInstallFailed = true;
      if (result.errors && result.errors.length > 0) {
        log(`Module ${result.module} errors: ${result.errors.join(', ')}`);
        print(`  ${symbols.error} Module ${result.module} post-install hook failed: ${result.errors.join(', ')}`, 'red');
      } else {
        log(`Module ${result.module} post-install hook failed`);
        print(`  ${symbols.error} Module ${result.module} post-install hook failed`, 'red');
      }
    }
    // Debug logging for test mode
    if (process.env.NODE_ENV === 'test' && result.skipped) {
      log(`[DEBUG] Module ${result.module} hook skipped: ${result.message || 'unknown reason'}`);
    }
  }
  
  // Fail installation if post-install hooks failed
  if (postInstallFailed) {
    print(`\n${symbols.error} Installation failed: One or more post-install hooks failed`, 'red');
    log(`Installation failed: One or more post-install hooks failed`);
    process.exit(1);
  }
  
  // Create .cache/devduck directory
  const cacheDevduckDir = path.join(WORKSPACE_ROOT, '.cache', 'devduck');
  if (!fs.existsSync(cacheDevduckDir)) {
    fs.mkdirSync(cacheDevduckDir, { recursive: true });
  }

  // If projects are defined in workspace.config.json, create symlinks/clones now.
  if (config.projects && Array.isArray(config.projects) && config.projects.length > 0) {
    const env = readEnvFile(ENV_FILE);
    await processProjects(config.projects, env);
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
    showStatus();
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
    
    // Close log stream
    if (logStream) {
      await new Promise((resolve) => {
        logStream.end(resolve);
      });
    }
    
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
  
  // Generate mcp.json
  const mcpServers = generateMcpJson(WORKSPACE_ROOT, { log, print, symbols });
  
  // Check MCP servers if they were generated
  let mcpResults = [];
  if (mcpServers) {
    mcpResults = await checkMcpServers(mcpServers, WORKSPACE_ROOT, { log, print, symbols });
  }
  
  // Read configuration
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${CONFIG_FILE}`, 'red');
    log(`ERROR: Cannot read configuration file: ${CONFIG_FILE}`);
    process.exit(1);
  }
  
  log(`Configuration loaded from: ${CONFIG_FILE}`);
  
  // Run pre-install checks (verify tokens before installing modules)
  print(`\n${symbols.info} Running pre-install checks...`, 'cyan');
  log(`Running pre-install checks`);
  try {
    const { runPreInstallChecks, validatePreInstallChecks } = await import('./install/pre-install-check.js');
    const checkResults = await runPreInstallChecks(WORKSPACE_ROOT);
    const validation = validatePreInstallChecks(checkResults, { print, log, symbols });
    if (validation === 'needs_input') {
      // Not a failure, but we must not continue with installation checks until tokens are provided.
      if (logStream) {
        await new Promise((resolve) => {
          logStream.end(resolve);
        });
      }
      process.exit(0);
    }
    if (validation === 'failed') {
      process.exit(1);
    }
  } catch (error) {
    const err = error as Error;
    print(`\n${symbols.error} Pre-install check error: ${err.message}`, 'red');
    log(`Pre-install check error: ${err.message}\n${err.stack}`);
    process.exit(1);
  }
  
  // Read existing cache if present
  let existingCache = readJSON(CACHE_FILE);
  if (existingCache) {
    log(`Existing cache file found: ${CACHE_FILE}`);
  } else {
    log(`No existing cache file found, creating new one`);
  }
  
  // Read .env file for variable substitution
  const env = readEnvFile(ENV_FILE);
  
  // Load modules to collect checks from them (same logic as installWorkspace)
  const moduleResolver = await import('./install/module-resolver.js');
  const { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies, mergeModuleSettings, loadModuleFromPath } = moduleResolver;
  type Module = Awaited<ReturnType<typeof getAllModules>>[number];
  const { loadModulesFromRepo, getDevduckVersion } = await import('./lib/repo-modules.js');
  const { loadModuleResources } = await import('./install/module-loader.js');
  
  // Load external modules from repos
  const externalModules: Module[] = [];
  if (config.repos && config.repos.length > 0) {
    log(`Loading modules from ${config.repos.length} repository/repositories for checks`);
    const devduckVersion = getDevduckVersion();
    
    for (const repoUrl of config.repos) {
      try {
        print(`  Loading modules [${repoUrl}]...`, 'cyan');
        const repoModulesPath = await loadModulesFromRepo(repoUrl, WORKSPACE_ROOT, devduckVersion);
        if (fs.existsSync(repoModulesPath)) {
          const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
          for (const entry of repoModuleEntries) {
            if (entry.isDirectory()) {
              const modulePath = path.join(repoModulesPath, entry.name);
              const module = loadModuleFromPath(modulePath, entry.name);
              if (module) {
                externalModules.push(module);
              }
            }
          }
        }
      } catch (error) {
        const err = error as Error;
        log(`Failed to load modules from ${repoUrl} for checks: ${err.message}`);
      }
    }
  }
  
  // Load all modules with priority: workspace > projects > external > built-in
  const localModules = getAllModules();
  const workspaceModulesDir = path.join(WORKSPACE_ROOT, 'modules');
  const workspaceModules = getAllModulesFromDirectory(workspaceModulesDir);
  
  const projectsModules: Module[] = [];
  if (config.projects && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      const projectName = project.src.split('/').pop()?.replace(/\.git$/, '') || '';
      const projectPath = path.join(WORKSPACE_ROOT, 'projects', projectName);
      const projectModulesDir = path.join(projectPath, 'modules');
      if (fs.existsSync(projectModulesDir)) {
        const projectModules = getAllModulesFromDirectory(projectModulesDir);
        projectsModules.push(...projectModules);
      }
    }
  }
  
  const allModules = [...workspaceModules, ...projectsModules, ...externalModules, ...localModules];
  const moduleNames = expandModuleNames(config.modules || ['*'], allModules);
  const resolvedModules = resolveDependencies(moduleNames, allModules);
  
  const loadedModules = resolvedModules.map(module => {
    const resources = loadModuleResources(module);
    const mergedSettings = mergeModuleSettings(module, config.moduleSettings);
    return {
      ...resources,
      settings: mergedSettings
    };
  });
  
  log(`Loaded ${loadedModules.length} module(s) for checks collection (${workspaceModules.length} workspace, ${projectsModules.length} projects, ${externalModules.length} external, ${localModules.length} devduck)`);
  
  // Collect checks from all modules
  const moduleChecks: Array<{ name?: string; description?: string; tier?: string; [key: string]: unknown }> = [];
  for (const module of loadedModules) {
    if (module.checks && Array.isArray(module.checks) && module.checks.length > 0) {
      log(`Module ${module.name} has ${module.checks.length} check(s)`);
      for (const check of module.checks) {
        // Add module name to check for identification
        const moduleCheck = {
          ...check,
          module: module.name,
          name: check.name || `${module.name}-${check.type || 'check'}`
        };
        moduleChecks.push(moduleCheck);
      }
    }
  }
  
  // Merge workspace config checks with module checks
  const allChecks = [
    ...(config.checks || []),
    ...moduleChecks
  ];
  
  const results = {
    checks: [],
    mcpServers: mcpResults,
    projects: []
  };
  
  // Check all items in checks array (from config and modules), grouped by tier
  if (allChecks.length > 0) {
    print(`\n${symbols.info} Running checks...`, 'cyan');
    
    // Group checks by tier
    const checksByTier = {};
    for (const item of allChecks) {
      const tier = item.tier || DEFAULT_TIER;
      if (!checksByTier[tier]) {
        checksByTier[tier] = [];
      }
      checksByTier[tier].push(item);
    }
    
    // Execute checks in tier order
    for (const tier of TIER_ORDER) {
      const tierChecks = checksByTier[tier];
      if (!tierChecks || tierChecks.length === 0) {
        continue;
      }
      
      print(`\n[${tier}] Running ${tierChecks.length} check(s)...`, 'cyan');
      log(`Tier: ${tier} - ${tierChecks.length} check(s)`);
      
      // Read .env file for variable substitution
      const env = readEnvFile(ENV_FILE);
      
      for (const item of tierChecks) {
        // Skip check if skip=true in config
        if (item.skip === true) {
          print(`  ${symbols.warning} ${item.name}: skipped`, 'yellow');
          log(`CHECK SKIPPED: ${item.name}`);
          results.checks.push({
            name: item.name,
            description: item.description || '',
            passed: null,
            skipped: true,
            tier: tier
          });
          continue;
        }
        
        // Mark auth checks without test commands as failed
        if (item.type === 'auth' && (!item.test || typeof item.test !== 'string' || !item.test.trim())) {
          const moduleName = (item as { module?: string }).module;
          const contextType = moduleName ? 'module' : 'workspace';
          const contextName = moduleName || null;
          print(`Checking ${item.name}${contextName ? ` [${contextName}]` : ''}...`, 'cyan');
          log(`CHECK FAILED: ${item.name} (${contextType}: ${contextName || 'workspace'}) - auth check without test command`);
          print(`${symbols.error} ${item.name} - No test command specified for auth check`, 'red');
          if (item.description) {
            print(item.description, 'red');
          }
          const docs = (item as { docs?: string }).docs;
          if (docs) {
            print(docs, 'red');
          }
          results.checks.push({
            name: item.name,
            description: item.description || '',
            passed: false,
            skipped: false,
            tier: tier,
            note: 'No test command specified for auth check'
          });
          continue;
        }
        
        // Determine context type: 'workspace' for config.checks, 'module' for module checks
        const moduleName = (item as { module?: string }).module;
        const contextType = moduleName ? 'module' : 'workspace';
        const contextName = moduleName || null;
        
        // Use unified processCheck function
        const checkResult = await processCheck(
          contextType,
          contextName,
          item,
          {
            tier: tier,
            workspaceRoot: WORKSPACE_ROOT,
            checkCommand,
            checkHttpAccess,
            isHttpRequest,
            replaceVariablesInObjectWithLog
          }
        );
        results.checks.push(checkResult);
      }
    }
  }
  
  // Check if any checks failed (not passed)
  const failedChecks = results.checks.filter(c => c.passed === false);
  
  // Process projects (create symlinks and run project-specific checks)
  // Only if all checks passed
  if (config.projects && config.projects.length > 0) {
    if (failedChecks.length > 0) {
      print(`\n${symbols.warning} Skipping projects processing: ${failedChecks.length} check(s) failed`, 'yellow');
      log(`Skipping projects processing due to ${failedChecks.length} failed check(s): ${failedChecks.map(c => c.name).join(', ')}`);
    } else {
      results.projects = await processProjects(config.projects, env);
      
      // Install project scripts to workspace package.json
      try {
        const { installProjectScripts } = await import('./install/install-project-scripts.js');
        print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
        log(`Installing project scripts to workspace package.json`);
        installProjectScripts(WORKSPACE_ROOT, config.projects, config, log);
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
    }
  }
  
  // Write results to cache
  writeJSON(CACHE_FILE, results);
  log(`\nResults written to: ${CACHE_FILE}`);
  
  // Summary
  const checksPassed = results.checks.filter(c => c.passed === true).length;
  const checksSkipped = results.checks.filter(c => c.skipped === true).length;
  const checksTotal = results.checks.length;
  
  // Calculate MCP statistics - exclude optional servers from failure count
  let mcpWorking = 0;
  let mcpTotal = 0;
  let mcpOptionalFailed = 0;
  if (results.mcpServers) {
    mcpTotal = results.mcpServers.length;
    mcpWorking = results.mcpServers.filter(m => m.working).length;
    // Count optional servers that failed (for informational purposes)
    mcpOptionalFailed = results.mcpServers.filter(m => !m.working && m.optional).length;
  }
  
  // Count non-optional servers that are working vs total non-optional
  const mcpRequiredTotal = results.mcpServers ? results.mcpServers.filter(m => !m.optional).length : 0;
  const mcpRequiredWorking = results.mcpServers ? results.mcpServers.filter(m => !m.optional && m.working).length : 0;
  
  // Calculate project statistics
  const projectsTotal = results.projects ? results.projects.length : 0;
  const projectsWithSymlink = results.projects ? results.projects.filter(p => p.symlink && !p.symlink.error).length : 0;
  let projectChecksPassed = 0;
  let projectChecksTotal = 0;
  let projectChecksSkipped = 0;
  if (results.projects) {
    for (const project of results.projects) {
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
    // Show required servers status, and optional if any failed
    if (mcpRequiredTotal > 0) {
      const mcpStatus = mcpRequiredWorking === mcpRequiredTotal ? 'green' : 'yellow';
      let mcpMsg = `  MCP Servers: ${mcpRequiredWorking}/${mcpRequiredTotal} required working`;
      if (mcpOptionalFailed > 0) {
        mcpMsg += ` (${mcpOptionalFailed} optional failed)`;
      }
      print(mcpMsg, mcpStatus);
    } else if (mcpOptionalFailed > 0) {
      // Only optional servers, show warning if any failed
      print(`  MCP Servers: ${mcpWorking}/${mcpTotal} working (${mcpOptionalFailed} optional failed)`, 'yellow');
    } else {
      // All working
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
  print(`\n${symbols.file} Results saved to .cache/install-check.json`, 'cyan');
  print(`${symbols.log} Logs written to .cache/install.log\n`, 'cyan');
  
  log(`\n=== Installation check completed at ${new Date().toISOString()} ===\n`);
  
  // Exit with error code if something failed (excluding optional MCP servers)
  // Check if any required MCP servers failed
  const mcpRequiredFailed = results.mcpServers ? results.mcpServers.filter(m => !m.optional && !m.working).length : 0;
  // Skipped checks are not failures, and should not affect exit code.
  // Treat the run as failed only if there are actual failed checks or required MCP failures.
  const checksFailed = results.checks.filter(c => c.passed === false).length;
  const hasFailures = checksFailed > 0 || mcpRequiredFailed > 0;
  
  // Close log stream and wait for it to finish before exiting
  if (logStream) {
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }
  
  if (hasFailures) {
    process.exit(1);
  }
}

// Run main function
main().catch(async (error) => {
  const err = error as Error;
  print(`\n${symbols.error} Fatal error: ${err.message}`, 'red');
  if (logStream) {
    log(`FATAL ERROR: ${err.message}\n${err.stack}`);
    await new Promise<void>((resolve) => {
      if (logStream) {
        logStream.end(() => resolve());
      } else {
        resolve();
      }
    });
  }
  process.exit(1);
});
