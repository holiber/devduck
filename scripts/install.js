#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { spawnSync } = require('child_process');
const { print, symbols, executeCommand, executeInteractiveCommand, requiresSudo, createReadlineInterface, promptUser } = require('./utils');

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

// CLI flags - parse early
const argv = process.argv.slice(2);

// Parse workspace installation parameters
function getArgValue(argName) {
  const index = argv.indexOf(argName);
  if (index !== -1 && index < argv.length - 1) {
    return argv[index + 1];
  }
  return null;
}

const WORKSPACE_PATH = getArgValue('--workspace-path');
const INSTALL_MODULES = getArgValue('--modules');
const AI_AGENT = getArgValue('--ai-agent');
const REPO_TYPE = getArgValue('--repo-type');
const SKIP_REPO_INIT = argv.includes('--skip-repo-init');
const CONFIG_FILE_PATH = getArgValue('--config');

// Determine workspace root
let WORKSPACE_ROOT;
if (WORKSPACE_PATH) {
  WORKSPACE_ROOT = path.resolve(WORKSPACE_PATH);
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
let logStream = null;

// CLI flags
const AUTO_YES = argv.includes('-y') || argv.includes('--yes') || argv.includes('--non-interactive') || argv.includes('--unattended');
const CHECK_TOKENS_ONLY = argv.includes('--check-tokens-only');
const STATUS_ONLY = argv.includes('--status');

// Parse --test-checks and --checks parameters
function parseChecksParam(paramName) {
  const param = argv.find(arg => arg.startsWith(`${paramName}=`));
  if (!param) return null;
  const value = param.split('=')[1];
  if (!value) return [];
  return value.split(',').map(c => c.trim()).filter(c => c.length > 0);
}

const TEST_CHECKS = parseChecksParam('--test-checks');
const CHECKS = parseChecksParam('--checks');

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
function log(message) {
  const timestamp = new Date().toISOString();
  logStream.write(`[${timestamp}] ${message}\n`);
}


/**
 * Read JSON file
 */
function readJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Write JSON file
 */
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}


/**
 * Install software using install command
 */
async function installSoftware(item) {
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
        : executeCommand(install, '/bin/bash');
      
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
      print(`  ${symbols.error} Installation error: ${error.message}`, 'red');
      log(`  Installation ERROR - ${error.message}`);
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
function isFilePath(check) {
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

/**
 * Check if file or directory exists
 */
function checkFileExists(filePath) {
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
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      path: filePath,
      error: error.message
    };
  }
}

/**
 * Get project name from path_in_arcadia or src
 * e.g., "crm/frontend/services/shell" -> "shell"
 * e.g., "github.com/holiber/devduck" -> "devduck"
 * e.g., "arc://junk/user/project" -> "project"
 */
function getProjectName(projectSrcOrPath) {
  if (!projectSrcOrPath) return 'unknown';
  
  // Handle arc:// URLs
  if (projectSrcOrPath.startsWith('arc://')) {
    const pathPart = projectSrcOrPath.replace('arc://', '');
    return path.basename(pathPart);
  }
  
  // Handle GitHub URLs
  if (projectSrcOrPath.includes('github.com/')) {
    const match = projectSrcOrPath.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match) {
      return match[1].replace('.git', '');
    }
  }
  
  // Handle regular paths
  return path.basename(projectSrcOrPath);
}

/**
 * Create symlink for a project
 */
function createProjectSymlink(projectName, pathInArcadia, env) {
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
    log(`Error creating symlink: ${error.message}`);
    return { success: false, path: symlinkPath, target: targetPath, error: error.message };
  }
}

/**
 * Check if test string is an HTTP request (format: "GET https://..." or "POST https://...")
 */
function isHttpRequest(test) {
  if (!test) return false;
  const trimmed = test.trim();
  return /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+https?:\/\//i.test(trimmed);
}

/**
 * Check software/command installation
 * @param {object} item - Check item with name, description, test, install
 * @param {string} context - Optional context prefix for logging (e.g., project name)
 * @param {boolean} skipInstall - If true, skip installation even if check fails
 */
async function checkCommand(item, context = null, skipInstall = false) {
  const { name, description, test, install } = item;
  const logPrefix = context ? `[${context}] ` : '';
  
  print(`${logPrefix}Checking ${name}...`, 'cyan');
  log(`${logPrefix}Checking command: ${name} (${description})`);
  
  // Default test for MCP checks: if no explicit test provided, verify MCP via tools/list
  // using scripts/test-mcp.js against the generated .cursor/mcp.json configuration.
  let effectiveTest = test;
  if ((!effectiveTest || typeof effectiveTest !== 'string' || !effectiveTest.trim()) && item.mcpSettings && name) {
    effectiveTest = `node "${path.join(PROJECT_ROOT, 'scripts', 'test-mcp.js')}" "${name}"`;
  }

  // If no test command, skip verification
  if (!effectiveTest) {
    print(`${logPrefix}  ${symbols.warning} ${name} - No test command specified`, 'yellow');
    log(`${logPrefix}  No test command specified for ${name}`);
    return {
      name: name,
      passed: false,
      version: null,
      note: 'No test command specified'
    };
  }
  
  // Read .env file for variable substitution
  const env = readEnvFile(ENV_FILE);
  
  // Replace variables in test and install commands
  const testWithVars = replaceVariables(effectiveTest, env);
  const installWithVars = install ? replaceVariables(install, env) : install;
  
  try {
    // Check if test is a file path or a command
    if (isFilePath(testWithVars)) {
      // It's a file/directory path - check if it exists
      log(`${logPrefix}File/directory path: ${testWithVars}`);
      
      const fileCheck = checkFileExists(testWithVars);
      
      if (fileCheck.exists && (fileCheck.isFile || fileCheck.isDirectory)) {
        const typeLabel = fileCheck.isDirectory ? 'Directory' : 'File';
        print(`${logPrefix}  ${symbols.success} ${name} (${description}) - ${typeLabel} exists: ${fileCheck.path}`, 'green');
        log(`${logPrefix}  Result: SUCCESS - ${typeLabel} exists: ${fileCheck.path}`);
        
        return {
          name: name,
          passed: true,
          version: fileCheck.isDirectory ? 'directory exists' : 'file exists',
          filePath: fileCheck.path
        };
      } else {
        // File/directory not found
        print(`${logPrefix}  ${symbols.error} ${name} (${description}) - Path not found: ${testWithVars}`, 'red');
        log(`${logPrefix}  Result: FAILED - Path not found: ${fileCheck.path}`);
        
        // If install command is available, offer to install (unless skipInstall is true)
        if (installWithVars && !skipInstall) {
          // Create item with replaced variables for installation
          const itemWithVars = { ...item, install: installWithVars };
          const installed = await installSoftware(itemWithVars);
          
          if (installed) {
            // Re-check after installation
            print(`${logPrefix}  Re-checking ${name} after installation...`, 'cyan');
            log(`${logPrefix}Re-checking ${name} after installation`);
            
            const recheckFile = checkFileExists(testWithVars);
            
            if (recheckFile.exists && (recheckFile.isFile || recheckFile.isDirectory)) {
              const typeLabel = recheckFile.isDirectory ? 'Directory' : 'File';
              print(`${logPrefix}  ${symbols.success} ${name} (${description}) - ${typeLabel} exists: ${recheckFile.path} (installed)`, 'green');
              log(`${logPrefix}  Re-check SUCCESS - ${typeLabel} exists: ${recheckFile.path}`);
              
              return {
                name: name,
                passed: true,
                version: recheckFile.isDirectory ? 'directory exists' : 'file exists',
                filePath: recheckFile.path,
                note: 'Installed during setup'
              };
            } else {
              print(`${logPrefix}  ${symbols.warning} ${name} - Installation completed but path not found`, 'yellow');
              log(`${logPrefix}  Re-check FAILED - Installation may have succeeded but path not found`);
              
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
      log(`${logPrefix}Command: ${testWithVars}`);
      
      // Special handling for nvm - need to source it first
      let command = testWithVars;
      if (name === 'nvm') {
        command = `source ~/.nvm/nvm.sh && ${testWithVars}`;
      }
      
      // Use interactive mode for sudo commands to allow password input
      const isSudo = requiresSudo(command);
      const result = isSudo ? executeInteractiveCommand(command) : executeCommand(command);
      
      if (result.success) {
        const version = isSudo ? 'passed' : (result.output || 'unknown');
        print(`${logPrefix}  ${symbols.success} ${name} (${description}) - ${version}`, 'green');
        log(`${logPrefix}  Result: SUCCESS - Version: ${version}`);
        
        return {
          name: name,
          passed: true,
          version: version
        };
      } else {
        // Software not installed
        print(`${logPrefix}  ${symbols.error} ${name} (${description}) - Not installed`, 'red');
        log(`${logPrefix}  Result: FAILED - ${result.error || 'Command failed'}`);
        
        // If install command is available, offer to install (unless skipInstall is true)
        if (install && !skipInstall) {
          const installed = await installSoftware(item);
          
          if (installed) {
            // Re-check after installation
            print(`${logPrefix}  Re-checking ${name} after installation...`, 'cyan');
            log(`${logPrefix}Re-checking ${name} after installation`);
            
            const recheckResult = isSudo ? executeInteractiveCommand(command) : executeCommand(command);
            
            if (recheckResult.success) {
              const version = isSudo ? 'passed' : (recheckResult.output || 'unknown');
              print(`${logPrefix}  ${symbols.success} ${name} (${description}) - ${version} (installed)`, 'green');
              log(`${logPrefix}  Re-check SUCCESS - Version: ${version}`);
              
              return {
                name: name,
                passed: true,
                version: version,
                note: 'Installed during setup'
              };
            } else {
              print(`${logPrefix}  ${symbols.warning} ${name} - Installation completed but verification failed`, 'yellow');
              log(`${logPrefix}  Re-check FAILED - Installation may have succeeded but verification failed`);
              
              return {
                name: name,
                passed: false,
                version: null,
                note: 'Installation attempted but verification failed'
              };
            }
          }
        }
        
        return {
          name: name,
          passed: false,
          version: null
        };
      }
    }
  } catch (error) {
    print(`${logPrefix}  ${symbols.error} ${name} (${description}) - Error: ${error.message}`, 'red');
    log(`${logPrefix}  Result: ERROR - ${error.message}`);
    
    return {
      name: name,
      passed: false,
      version: null
    };
  }
}

/**
 * Make HTTP request
 */
function makeHttpRequest(method, url, headers = {}) {
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
 * Make HTTP request for MCP server (with proper headers and longer timeout)
 */
function makeMcpHttpRequest(method, url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    // MCP servers typically require Accept: text/event-stream
    // Use HEAD request for faster check, or GET if HEAD is not supported
    const headers = {
      'Accept': 'text/event-stream, application/json',
      'User-Agent': 'MCP-Client/1.0'
    };
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: headers,
      timeout: 5000 // 5 seconds - enough to check if server responds
    };
    
    const req = httpModule.request(options, (res) => {
      let data = '';
      
      // For HEAD requests, we might not get data
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const statusCode = res.statusCode;
        // Any response (except 404) means server is reachable
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
      // For MCP servers, timeout might mean server is slow but working
      // Try a simpler check - just verify the host is reachable
      resolve({
        success: false,
        statusCode: null,
        error: 'Request timeout (server may be slow or require different protocol)',
        body: null,
        timeout: true
      });
    });
    
    req.end();
  });
}


/**
 * Parse .env file content
 */
function parseEnvFile(content) {
  const env = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Parse KEY="VALUE" or KEY=VALUE format
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))?/);
    if (match) {
      const key = match[1];
      const value = match[2] || match[3] || match[4] || '';
      env[key] = value;
    }
  }
  
  return env;
}

/**
 * Read .env file
 */
function readEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return parseEnvFile(content);
  } catch (error) {
    return {};
  }
}

/**
 * Write .env file
 */
function writeEnvFile(filePath, env) {
  const lines = [];
  for (const [key, value] of Object.entries(env)) {
    // Escape quotes in value and wrap in quotes if contains spaces or special chars
    const escapedValue = value.includes(' ') || value.includes('"') || value.includes("'")
      ? `"${value.replace(/"/g, '\\"')}"`
      : value;
    lines.push(`${key}=${escapedValue}`);
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Setup .env file from workspace.config.json
 */
async function setupEnvFile() {
  // Check if .env already exists
  if (fs.existsSync(ENV_FILE)) {
    print(`\n${symbols.info} .env file already exists, skipping setup`, 'cyan');
    log(`.env file already exists: ${ENV_FILE}`);
    return;
  }
  
  // Read configuration
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`\n${symbols.warning} Cannot read ${CONFIG_FILE}, skipping .env setup`, 'yellow');
    log(`Cannot read configuration file: ${CONFIG_FILE}`);
    return;
  }
  
  // Check if env section exists in config
  if (!config.env || !Array.isArray(config.env) || config.env.length === 0) {
    print(`\n${symbols.info} No environment variables defined in config, skipping .env setup`, 'cyan');
    log(`No environment variables found in workspace.config.json`);
    return;
  }
  
  print(`\n${symbols.info} Setting up .env file from workspace.config.json...`, 'cyan');
  log(`Reading environment variables from: ${CONFIG_FILE}`);
  
  const env = {};
  
  // Prompt for each variable (unless running in non-interactive mode)
  if (AUTO_YES) {
    print(`\n${symbols.info} Non-interactive mode: generating .env from defaults and environment`, 'cyan');
    log(`Non-interactive mode: generating .env without prompts`);
  } else {
    print(`\n${symbols.info} Please provide values for environment variables:`, 'cyan');
  }

  const rl = AUTO_YES ? null : createReadlineInterface();
  for (const envVar of config.env) {
    const key = envVar.name || envVar.key;
    const defaultValue = envVar.default || envVar.value || '';
    const comment = envVar.comment || envVar.description || '';
    
    // Show comment if available
    if (comment) {
      print(`  ${symbols.info} ${comment}`, 'cyan');
    }
    
    const fromProcessEnv = process.env[key];
    if (AUTO_YES) {
      env[key] = (fromProcessEnv !== undefined ? fromProcessEnv : (defaultValue || ''));
      log(`Environment variable ${key} = ${env[key]}${comment ? ` (${comment})` : ''} [non-interactive]`);
      continue;
    }

    const question = `  ${key}${defaultValue ? ` [${defaultValue}]` : ''}: `;
    const answer = await promptUser(rl, question);
    env[key] = answer || fromProcessEnv || defaultValue || '';
    log(`Environment variable ${key} = ${env[key]}${comment ? ` (${comment})` : ''}`);
  }
  
  if (rl) {
    rl.close();
  }
  
  // Write .env file
  writeEnvFile(ENV_FILE, env);
  print(`\n${symbols.success} .env file created successfully`, 'green');
  log(`.env file created: ${ENV_FILE}`);
}

/**
 * Replace variables in string (format: $$VAR_NAME$$)
 */
function replaceVariables(str, env) {
  if (typeof str !== 'string') {
    return str;
  }
  
  return str.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => {
    // First check environment variables, then .env file
    const value = process.env[varName] || env[varName];
    if (value !== undefined) {
      return value;
    }
    // If not found, return original match with warning
    print(`  ${symbols.warning} Variable ${match} not found, keeping as is`, 'yellow');
    log(`Warning: Variable ${match} not found in environment or .env file`);
    return match;
  });
}

/**
 * Recursively replace variables in object
 */
function replaceVariablesInObject(obj, env) {
  if (typeof obj === 'string') {
    return replaceVariables(obj, env);
  } else if (Array.isArray(obj)) {
    return obj.map(item => replaceVariablesInObject(item, env));
  } else if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceVariablesInObject(value, env);
    }
    return result;
  }
  return obj;
}

/**
 * Generate mcp.json from workspace.config.json
 */
function generateMcpJson() {
  print(`\n${symbols.info} Generating .cursor/mcp.json...`, 'cyan');
  log(`Generating mcp.json from workspace.config.json`);
  
  // Read workspace.config.json
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`  ${symbols.warning} Cannot read ${CONFIG_FILE}, skipping MCP generation`, 'yellow');
    log(`WARNING: Cannot read configuration file: ${CONFIG_FILE}`);
    return null;
  }
  
  // Read .env file
  const env = readEnvFile(ENV_FILE);
  log(`Loaded environment variables from .env file: ${Object.keys(env).join(', ')}`);
  
  // Collect MCP servers from checks[].mcpSettings
  if (!config.checks || !Array.isArray(config.checks)) {
    print(`  ${symbols.info} No checks found in workspace.config.json, skipping MCP generation`, 'cyan');
    log(`No checks found in workspace.config.json (cannot generate mcp.json)`);
    return null;
  }

  const mcpServers = {};
  for (const item of config.checks) {
    if (!item || typeof item !== 'object') continue;
    if (!item.mcpSettings) continue;

    const serverName = item.name;
    if (!serverName || typeof serverName !== 'string') {
      print(`  ${symbols.warning} MCP check is missing string 'name', skipping`, 'yellow');
      log(`MCP check missing name: ${JSON.stringify(item)}`);
      continue;
    }

    // Replace $$VARS$$ in mcpSettings
    mcpServers[serverName] = replaceVariablesInObject(item.mcpSettings, env);
  }

  if (Object.keys(mcpServers).length === 0) {
    print(`  ${symbols.warning} No mcpSettings found in checks, skipping`, 'yellow');
    log(`No mcpSettings found in checks (cannot generate mcp.json)`);
    return null;
  }
  
  // Ensure .cursor directory exists
  if (!fs.existsSync(CURSOR_DIR)) {
    fs.mkdirSync(CURSOR_DIR, { recursive: true });
    log(`Created .cursor directory: ${CURSOR_DIR}`);
  }
  
  // Write mcp.json
  const mcpConfig = { mcpServers };
  writeJSON(MCP_FILE, mcpConfig);
  
  print(`  ${symbols.success} .cursor/mcp.json generated successfully`, 'green');
  log(`mcp.json written to: ${MCP_FILE}`);
  
  return mcpServers;
}

/**
 * Check if file/command exists and is executable
 */
function checkCommandExists(commandPath) {
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
      return { exists: false, executable: false, error: error.message };
    }
  } catch (error) {
    return { exists: false, executable: false, error: error.message };
  }
}

/**
 * Check MCP server
 */
async function checkMcpServer(name, serverConfig) {
  print(`Checking MCP server: ${name}...`, 'cyan');
  log(`Checking MCP server: ${name}`);
  
  // Check if server is marked as optional
  const isOptional = serverConfig.optional === true;
  if (isOptional) {
    log(`  Server is marked as optional`);
  }
  
  try {
    // Check URL-based server
    if (serverConfig.url) {
      log(`  Type: URL-based server`);
      log(`  URL: ${serverConfig.url}`);
      
      // Try HEAD first (faster), then GET if HEAD fails
      let result = await makeMcpHttpRequest('HEAD', serverConfig.url);
      
      // If HEAD times out or fails, try GET (some servers don't support HEAD)
      if (result.timeout || (!result.success && !result.statusCode)) {
        log(`  HEAD request failed, trying GET...`);
        result = await makeMcpHttpRequest('GET', serverConfig.url);
      }
      
      // Check if server responded (even with error, it means server is working)
      // MCP servers may return JSON-RPC errors which indicate the server is reachable
      if (result.success || (result.statusCode && result.statusCode !== 404)) {
        // Check if response contains JSON-RPC error (which means server is working)
        let isWorking = result.success;
        let errorMessage = null;
        
        if (result.body) {
          try {
            const jsonResponse = JSON.parse(result.body);
            // If we get a JSON-RPC error response, the server is working
            // It just requires proper MCP protocol handshake
            if (jsonResponse.error && jsonResponse.jsonrpc === '2.0') {
              isWorking = true;
              errorMessage = `Server requires MCP protocol (${jsonResponse.error.message || 'MCP handshake needed'})`;
              log(`  Server responded with JSON-RPC error, but server is reachable`);
            }
          } catch (e) {
            // Not JSON, check status code
            if (result.statusCode >= 200 && result.statusCode < 500) {
              isWorking = true;
            }
          }
        } else if (result.statusCode && result.statusCode >= 200 && result.statusCode < 500) {
          // HEAD request succeeded (no body)
          isWorking = true;
        }
        
        if (isWorking) {
          const statusMsg = errorMessage ? `(requires MCP protocol)` : `(${result.statusCode})`;
          print(`  ${symbols.success} ${name} - OK ${statusMsg}`, 'green');
          log(`  Result: SUCCESS - Status: ${result.statusCode}, Server is reachable`);
          
          return {
            name: name,
            type: 'url',
            url: serverConfig.url,
            working: true,
            optional: isOptional,
            statusCode: result.statusCode,
            note: errorMessage || null
          };
        }
      }
      
      // Handle timeout specially - for MCP servers, timeout might mean server uses SSE/WebSocket
      // and doesn't respond to regular HTTP, but server might still be working
      if (result.timeout) {
        // Try to verify the host is at least reachable with a simple DNS/connectivity check
        const urlObj = new URL(serverConfig.url);
        log(`  Request timed out, but server may use SSE/WebSocket protocol`);
        print(`  ${symbols.warning} ${name} - Timeout (server may require SSE/WebSocket connection)`, 'yellow');
        log(`  Result: TIMEOUT - Server may be working but requires different protocol`);
        
        // Consider it potentially working if URL is valid
        return {
          name: name,
          type: 'url',
          url: serverConfig.url,
          working: true, // Assume working, timeout might be due to protocol requirements
          optional: isOptional,
          statusCode: null,
          note: 'Timeout - server may require SSE/WebSocket (MCP protocol)',
          timeout: true
        };
      }
      
      // Server not reachable or 404
      if (isOptional) {
        print(`  ${symbols.warning} ${name} - Failed (${result.statusCode || result.error}) (optional)`, 'yellow');
        log(`  Result: WARNING (optional server) - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      } else {
        print(`  ${symbols.error} ${name} - Failed (${result.statusCode || result.error})`, 'red');
        log(`  Result: FAILED - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      }
      
      return {
        name: name,
        type: 'url',
        url: serverConfig.url,
        working: false,
        optional: isOptional,
        error: result.error || `HTTP ${result.statusCode}`
      };
    }
    
    // Check command-based server
    if (serverConfig.command) {
      log(`  Type: Command-based server`);
      log(`  Command: ${serverConfig.command}`);
      
      // Check if command exists
      const checkResult = checkCommandExists(serverConfig.command);
      
      if (checkResult.exists && checkResult.executable) {
        // For npx, we can't easily test it without actually running it
        // Just verify the command is available
        const commandName = serverConfig.command.split(/\s+/)[0];
        if (commandName === 'npx' || commandName === 'node' || commandName === 'npm') {
          // These are Node.js commands, assume they work if found
          print(`  ${symbols.success} ${name} - Command available (${commandName})`, 'green');
          log(`  Result: SUCCESS - Command exists: ${checkResult.path || serverConfig.command}`);
          
          return {
            name: name,
            type: 'command',
            command: serverConfig.command,
            working: true,
            optional: isOptional,
            commandPath: checkResult.path || serverConfig.command
          };
        }
        
        // For other commands, try a simple test
        try {
          // Just verify command exists, don't try to run it with args
          print(`  ${symbols.success} ${name} - Command available`, 'green');
          log(`  Result: SUCCESS - Command exists: ${checkResult.path || serverConfig.command}`);
          
          return {
            name: name,
            type: 'command',
            command: serverConfig.command,
            working: true,
            optional: isOptional,
            commandPath: checkResult.path || serverConfig.command
          };
        } catch (error) {
          // Command exists but test failed, still mark as available
          print(`  ${symbols.success} ${name} - Command available`, 'green');
          log(`  Result: SUCCESS - Command exists (test failed but command found)`);
          
          return {
            name: name,
            type: 'command',
            command: serverConfig.command,
            working: true,
            optional: isOptional,
            commandPath: checkResult.path || serverConfig.command
          };
        }
      } else {
        if (isOptional) {
          print(`  ${symbols.warning} ${name} - Command not found or not executable (optional)`, 'yellow');
          log(`  Result: WARNING (optional server) - Command not found or not executable: ${serverConfig.command}`);
        } else {
          print(`  ${symbols.error} ${name} - Command not found or not executable`, 'red');
          log(`  Result: FAILED - Command not found or not executable: ${serverConfig.command}`);
        }
        
        return {
          name: name,
          type: 'command',
          command: serverConfig.command,
          working: false,
          optional: isOptional,
          error: checkResult.error || 'Command not found or not executable'
        };
      }
    }
    
    // Unknown server type
    print(`  ${symbols.warning} ${name} - Unknown server type`, 'yellow');
    log(`  Result: WARNING - Unknown server type`);
    
    return {
      name: name,
      type: 'unknown',
      working: false,
      optional: isOptional,
      error: 'Unknown server configuration type'
    };
  } catch (error) {
    if (isOptional) {
      print(`  ${symbols.warning} ${name} - Error: ${error.message} (optional)`, 'yellow');
      log(`  Result: WARNING (optional server) - ${error.message}`);
    } else {
      print(`  ${symbols.error} ${name} - Error: ${error.message}`, 'red');
      log(`  Result: ERROR - ${error.message}`);
    }
    
    return {
      name: name,
      working: false,
      optional: isOptional,
      error: error.message
    };
  }
}

/**
 * Check all MCP servers
 */
async function checkMcpServers(mcpServers) {
  if (!mcpServers || Object.keys(mcpServers).length === 0) {
    return [];
  }
  
  print(`\n${symbols.info} Checking MCP servers...`, 'cyan');
  log(`Checking MCP servers from mcp.json`);
  
  const results = [];
  
  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const result = await checkMcpServer(name, serverConfig);
    results.push(result);
  }
  
  return results;
}

/**
 * Check HTTP access to service
 */
/**
 * Check HTTP access to service
 * @param {object} item - Check item with name, description, test
 * @param {string} context - Optional context prefix for logging (e.g., project name)
 */
async function checkHttpAccess(item, context = null) {
  const { name, description, test } = item;
  const logPrefix = context ? `[${context}] ` : '';
  
  print(`${logPrefix}Checking ${name}...`, 'cyan');
  log(`${logPrefix}Checking HTTP access: ${name} (${description})`);
  log(`${logPrefix}Request: ${test}`);
  
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
      print(`${logPrefix}  ${symbols.success} ${name} - OK (${result.statusCode})`, 'green');
      log(`${logPrefix}  Result: SUCCESS - Status: ${result.statusCode}`);
      
      return {
        name: name,
        passed: true,
        statusCode: result.statusCode
      };
    } else {
      print(`${logPrefix}  ${symbols.error} ${name} - Failed (${result.statusCode || result.error})`, 'red');
      log(`${logPrefix}  Result: FAILED - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      
      return {
        name: name,
        passed: false,
        error: result.error || `HTTP ${result.statusCode}`
      };
    }
  } catch (error) {
    print(`${logPrefix}  ${symbols.error} ${name} - Error: ${error.message}`, 'red');
    log(`${logPrefix}  Result: ERROR - ${error.message}`);
    
    return {
      name: name,
      passed: false,
      error: error.message
    };
  }
}

/**
 * Create symlink for a project and return initial result object
 */
function initProjectResult(project, env) {
  // Support both old format (path_in_arcadia) and new format (src)
  const projectSrcOrPath = project.path_in_arcadia || project.src;
  const projectName = getProjectName(projectSrcOrPath);
  
  print(`\n${symbols.info} Processing project: ${projectName}`, 'cyan');
  log(`Processing project: ${projectName} (${projectSrcOrPath})`);
  
  const result = {
    name: projectName,
    path_in_arcadia: projectSrcOrPath,
    src: project.src,
    symlink: null,
    checks: []
  };
  
  // Create symlink only if path_in_arcadia is provided (Arcadia projects)
  // GitHub projects don't need symlinks in workspace
  if (project.path_in_arcadia || (project.src && project.src.startsWith('arc://'))) {
    print(`  Creating symlink...`, 'cyan');
    // Remove arc:// prefix if present
    const pathForSymlink = projectSrcOrPath.replace(/^arc:\/\//, '');
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
function getProjectChecksByTier(project, env) {
  if (!project.checks || project.checks.length === 0) {
    return {};
  }
  
  const projectName = getProjectName(project.path_in_arcadia);
  const checksWithVars = replaceVariablesInObject(project.checks, env);
  
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
async function runCheck(check, projectName) {
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
  
  let checkResult;
  if (isHttpRequest(check.test)) {
    checkResult = await checkHttpAccess(check, projectName);
  } else {
    checkResult = await checkCommand(check, projectName);
  }
  return checkResult;
}

/**
 * Process all projects - create symlinks first, then run checks by tier across all projects
 */
async function processProjects(projects, env) {
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
 * @param {Array<string>} checkNames - Array of check names to run
 * @param {boolean} testOnly - If true, only test without installing
 */
async function runSelectedChecks(checkNames, testOnly = false) {
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
        const projectSrcOrPath = project.path_in_arcadia || project.src;
        const projectName = getProjectName(projectSrcOrPath);
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
    const context = check.projectName ? check.projectName : null;
    
    // Replace variables in check
    const checkWithVars = replaceVariablesInObject(check, env);
    
    // Skip check if skip=true in config
    if (checkWithVars.skip === true) {
      const prefix = context ? `[${context}] ` : '';
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
    
    // Detect check type by test format
    let checkResult;
    if (isHttpRequest(checkWithVars.test)) {
      // HTTP access check
      checkResult = await checkHttpAccess(checkWithVars, context);
    } else {
      // Command/software check
      checkResult = await checkCommand(checkWithVars, context, testOnly);
    }
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
function getDirectorySize(dirPath) {
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
        } catch (error) {
          // Skip files that can't be accessed
          continue;
        }
      }
    }
    
    return size;
  } catch (error) {
    return 0;
  }
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
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
  } catch (error) {
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
    const key = envVar.name || envVar.key;
    const comment = envVar.comment || envVar.description || '';
    
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

/**
 * Install workspace from scratch
 */
async function installWorkspace() {
  const { loadModulesForWorkspace } = require('./module-loader');
  const { executeHooksForStage, createHookContext } = require('./module-hooks');
  
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
    // Update existing config if modules specified
    if (INSTALL_MODULES) {
      const modules = INSTALL_MODULES.split(',').map(m => m.trim());
      config.modules = modules;
      writeJSON(CONFIG_FILE, config);
      print(`\n${symbols.info} Updated workspace.config.json with modules: ${modules.join(', ')}`, 'cyan');
      log(`Updated workspace.config.json with modules: ${modules.join(', ')}`);
    }
  }
  
  // Load modules from external repositories if specified
  const externalModules = [];
  if (config.repos && config.repos.length > 0) {
    print(`\n${symbols.info} Loading modules from external repositories...`, 'cyan');
    log(`Loading modules from ${config.repos.length} repository/repositories`);
    
    const { loadModulesFromRepo, getDevduckVersion } = require('./lib/repo-modules');
    const { loadModule } = require('./module-resolver');
    const devduckVersion = getDevduckVersion();
    
    for (const repoUrl of config.repos) {
      try {
        log(`Loading modules from repository: ${repoUrl}`);
        const repoModulesPath = await loadModulesFromRepo(repoUrl, WORKSPACE_ROOT, devduckVersion);
        
        // repoModulesPath is the path to modules directory
        // Load modules from the repository
        if (fs.existsSync(repoModulesPath)) {
          const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
          for (const entry of repoModuleEntries) {
            if (entry.isDirectory()) {
              const modulePath = path.join(repoModulesPath, entry.name);
              // Use loadModule but with custom path - need to parse manually
              const moduleMdPath = path.join(modulePath, 'MODULE.md');
              if (fs.existsSync(moduleMdPath)) {
                const content = fs.readFileSync(moduleMdPath, 'utf8');
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (frontmatterMatch) {
                  const yamlContent = frontmatterMatch[1];
                  const metadata = {};
                  const lines = yamlContent.split('\n');
                  
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    
                    const colonIndex = trimmed.indexOf(':');
                    if (colonIndex > 0) {
                      const key = trimmed.substring(0, colonIndex).trim();
                      let value = trimmed.substring(colonIndex + 1).trim();
                      
                      // Handle array values [item1, item2]
                      if (value.startsWith('[') && value.endsWith(']')) {
                        const arrayContent = value.slice(1, -1);
                        metadata[key] = arrayContent.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
                      } else {
                        metadata[key] = value.replace(/^["']|["']$/g, '');
                      }
                    }
                  }
                  
                  if (metadata.name) {
                    externalModules.push({
                      name: metadata.name || entry.name,
                      version: metadata.version || '0.1.0',
                      description: metadata.description || '',
                      tags: metadata.tags || [],
                      dependencies: metadata.dependencies || [],
                      defaultSettings: metadata.defaultSettings || {},
                      path: modulePath
                    });
                    print(`  ${symbols.success} Loaded external module: ${metadata.name || entry.name}`, 'green');
                    log(`Loaded external module: ${metadata.name || entry.name} from ${repoUrl}`);
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        print(`  ${symbols.warning} Failed to load modules from ${repoUrl}: ${error.message}`, 'yellow');
        log(`Failed to load modules from ${repoUrl}: ${error.message}`);
      }
    }
  }
  
  // Merge external modules with local modules
  const { getAllModules, resolveModules, resolveDependencies, mergeModuleSettings } = require('./module-resolver');
  const localModules = getAllModules();
  const allModules = [...localModules, ...externalModules];
  
  // Resolve modules manually with merged list
  let moduleNames = config.modules || ['*'];
  if (moduleNames.includes('*')) {
    moduleNames = allModules.map(m => m.name);
  }
  const resolvedModules = resolveDependencies(moduleNames, allModules);
  
  // Load module resources
  const { loadModuleResources } = require('./module-loader');
  const loadedModules = resolvedModules.map(module => {
    const resources = loadModuleResources(module);
    const mergedSettings = mergeModuleSettings(module, config.moduleSettings);
    
    return {
      ...resources,
      settings: mergedSettings
    };
  });
  
  print(`\n${symbols.info} Loaded ${loadedModules.length} module(s) (${localModules.length} local, ${externalModules.length} external)`, 'cyan');
  log(`Loaded modules: ${loadedModules.map(m => m.name).join(', ')}`);
  
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
  
  // Log results
  for (const result of postInstallResults) {
    if (result.success && result.message) {
      log(`Module ${result.module}: ${result.message}`);
    } else if (result.errors && result.errors.length > 0) {
      log(`Module ${result.module} errors: ${result.errors.join(', ')}`);
    }
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
async function main() {
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
  await setupEnvFile();
  
  // Generate mcp.json
  const mcpServers = generateMcpJson();
  
  // Check MCP servers if they were generated
  let mcpResults = [];
  if (mcpServers) {
    mcpResults = await checkMcpServers(mcpServers);
  }
  
  // Read configuration
  const config = readJSON(CONFIG_FILE);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${CONFIG_FILE}`, 'red');
    log(`ERROR: Cannot read configuration file: ${CONFIG_FILE}`);
    process.exit(1);
  }
  
  log(`Configuration loaded from: ${CONFIG_FILE}`);
  
  // Read existing cache if present
  let existingCache = readJSON(CACHE_FILE);
  if (existingCache) {
    log(`Existing cache file found: ${CACHE_FILE}`);
  } else {
    log(`No existing cache file found, creating new one`);
  }
  
  // Read .env file for variable substitution
  const env = readEnvFile(ENV_FILE);
  
  const results = {
    checks: [],
    mcpServers: mcpResults,
    projects: []
  };
  
  // Check all items in checks array, grouped by tier
  if (config.checks && config.checks.length > 0) {
    print(`\n${symbols.info} Running checks...`, 'cyan');
    
    // Group checks by tier
    const checksByTier = {};
    for (const item of config.checks) {
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
        
        // Replace variables in check item
        const itemWithVars = replaceVariablesInObject(item, env);
        
        // Detect check type by test format
        let checkResult;
        if (isHttpRequest(itemWithVars.test)) {
          // HTTP access check
          checkResult = await checkHttpAccess(itemWithVars);
        } else {
          // Command/software check
          checkResult = await checkCommand(itemWithVars);
        }
        // Add tier info to result
        checkResult.tier = tier;
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
        const { installProjectScripts } = require('./install/install-project-scripts');
        print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
        log(`Installing project scripts to workspace package.json`);
        installProjectScripts(WORKSPACE_ROOT, config.projects, config, log);
        print(`  ${symbols.success} Project scripts installed`, 'green');
      } catch (error) {
        print(`  ${symbols.warning} Failed to install project scripts: ${error.message}`, 'yellow');
        log(`ERROR: Failed to install project scripts: ${error.message}\n${error.stack}`);
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
  print(checksMsg, checksPassed === checksRan ? 'green' : 'yellow');
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
      projectsWithSymlink === projectsTotal ? 'green' : 'yellow');
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
  print(`\n${symbols.error} Fatal error: ${error.message}`, 'red');
  if (logStream) {
    log(`FATAL ERROR: ${error.message}\n${error.stack}`);
    await new Promise((resolve) => {
      logStream.end(resolve);
    });
  }
  process.exit(1);
});
