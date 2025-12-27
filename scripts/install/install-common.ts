#!/usr/bin/env node

/**
 * Common utilities for installation steps
 * 
 * Shared functions used across all installation steps to avoid code duplication
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { execSync, spawnSync } from 'child_process';
import { readEnvFile } from '../lib/env.js';
import { replaceVariables, replaceVariablesInObject } from '../lib/config.js';
import { print, symbols, executeCommand, executeInteractiveCommand, requiresSudo } from '../utils.js';
import type { CheckItem, CheckResult } from './types.js';
import type {
  CheckCommandFunction,
  CheckHttpAccessFunction,
  IsHttpRequestFunction,
  ReplaceVariablesFunction
} from './check-functions.js';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

/**
 * Environment variable requirement
 */
export interface EnvRequirement {
  name: string;
  source: string; // 'config' | 'module' | 'project'
  sourceName?: string; // module name or project name
  description?: string;
  optional?: boolean;
}

/**
 * Environment check result
 */
export interface EnvCheckResult {
  present: string[];
  missing: string[];
  optional: string[];
}

/**
 * Collect all environment variable requirements from config, modules, and projects
 */
export function collectAllEnvRequirements(
  workspaceRoot: string,
  config: Record<string, unknown>,
  loadedModules: Array<{ name: string; checks?: Array<{ type?: string; var?: string; description?: string; optional?: boolean }> }>,
  loadedProjects: Array<{ src?: string; checks?: Array<{ type?: string; var?: string; description?: string; optional?: boolean }> }>
): Map<string, EnvRequirement> {
  const requirements = new Map<string, EnvRequirement>();
  
  // Collect from config.env
  if (config.env && Array.isArray(config.env)) {
    for (const envVar of config.env) {
      if (typeof envVar === 'object' && envVar !== null) {
        const envObj = envVar as { name?: string; description?: string; optional?: boolean };
        if (envObj.name) {
          requirements.set(envObj.name, {
            name: envObj.name,
            source: 'config',
            description: envObj.description,
            optional: envObj.optional === true
          });
        }
      }
    }
  }
  
  // Collect from module checks (auth and test types)
  for (const module of loadedModules) {
    if (module.checks) {
      for (const check of module.checks) {
        if ((check.type === 'auth' || check.type === 'test') && check.var) {
          const varName = check.var;
          // Don't override if already exists (config takes precedence)
          if (!requirements.has(varName)) {
            requirements.set(varName, {
              name: varName,
              source: 'module',
              sourceName: module.name,
              description: check.description,
              optional: check.optional === true
            });
          }
        }
      }
    }
  }
  
  // Collect from project checks (auth type)
  for (const project of loadedProjects) {
    if (project.checks) {
      const projectName = project.src ? path.basename(project.src) : 'unknown';
      for (const check of project.checks) {
        if (check.type === 'auth' && check.var) {
          const varName = check.var;
          // Don't override if already exists (config and modules take precedence)
          if (!requirements.has(varName)) {
            requirements.set(varName, {
              name: varName,
              source: 'project',
              sourceName: projectName,
              description: check.description,
              optional: check.optional === true
            });
          }
        }
      }
    }
  }
  
  return requirements;
}

/**
 * Check which environment variables are present/missing
 */
export function checkEnvVariables(
  workspaceRoot: string,
  envRequirements: Map<string, EnvRequirement>,
  log?: (message: string) => void
): EnvCheckResult {
  const envFile = path.join(workspaceRoot, '.env');
  const env = readEnvFile(envFile);
  
  const present: string[] = [];
  const missing: string[] = [];
  const optional: string[] = [];
  
  for (const [varName, requirement] of envRequirements) {
    // Check in process.env first, then .env file
    const value = process.env[varName] || env[varName];
    const isPresent = value !== undefined && String(value).trim() !== '';
    
    if (isPresent) {
      present.push(varName);
      if (log) {
        log(`Env variable ${varName} is present`);
      }
    } else {
      if (requirement.optional) {
        optional.push(varName);
        if (log) {
          log(`Optional env variable ${varName} is missing`);
        }
      } else {
        missing.push(varName);
        if (log) {
          log(`Required env variable ${varName} is missing`);
        }
      }
    }
  }
  
  return { present, missing, optional };
}

/**
 * Check if test string is an HTTP request
 */
export function isHttpRequest(test: string | undefined): boolean {
  if (!test) return false;
  const trimmed = test.trim();
  return /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+https?:\/\//i.test(trimmed);
}

/**
 * Check if test string is a file path
 */
function isFilePath(check: string | undefined): boolean {
  if (!check) return false;
  
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
interface FileCheckResult {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
  error?: string;
}

function checkFileExists(filePath: string, projectRoot: string): FileCheckResult {
  try {
    // Expand ~ to home directory
    const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
    
    // Resolve relative paths
    const resolvedPath = path.isAbsolute(expandedPath) 
      ? expandedPath 
      : path.resolve(projectRoot, expandedPath);
    
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
 * Make HTTP request
 */
interface HttpRequestResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  body: string | null;
  timeout?: boolean;
}

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
        const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 500 && statusCode !== 404;
        
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
 * Install software using install command
 */
async function installSoftware(
  item: CheckItem,
  workspaceRoot: string,
  log?: (message: string) => void,
  autoYes = false
): Promise<boolean> {
  const { name, description, install } = item;
  
  if (!install) return false;
  
  print(`  ${symbols.info} Installation command found for ${name}`, 'cyan');
  if (log) {
    log(`Installation command: ${install}`);
  }
  
  // Ask user if they want to install (unless running in non-interactive mode)
  let answer = 'y';
  if (!autoYes) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (query: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(query, resolve);
      });
    };
    
    answer = await question(`  Do you want to install ${name}? (y/n) [y]: `);
    rl.close();
  } else {
    print(`  ${symbols.info} Non-interactive mode: auto-installing ${name}`, 'cyan');
    if (log) {
      log(`Non-interactive mode: auto-installing ${name}`);
    }
  }
  
  if (answer.toLowerCase() !== 'n' && answer.toLowerCase() !== 'no') {
    print(`  Installing ${name}...`, 'cyan');
    if (log) {
      log(`Executing installation command: ${install}`);
    }
    
    try {
      // Execute installation command
      // Use interactive mode for sudo commands to allow password input
      const isSudo = requiresSudo(install);
      const result = isSudo 
        ? executeInteractiveCommand(install)
        : executeCommand(install, { shell: '/bin/bash', cwd: item._execCwd });
      
      if (result.success) {
        print(`  ${symbols.success} Installation command completed`, 'green');
        if (log) {
          log(`  Installation SUCCESS - Output: ${result.output || '(interactive)'}`);
        }
        return true;
      } else {
        print(`  ${symbols.error} Installation failed: ${result.error || 'Command failed'}`, 'red');
        if (log) {
          log(`  Installation FAILED - Error: ${result.error || 'Command failed'}`);
          if (result.output) {
            log(`  Installation output: ${result.output}`);
          }
        }
        return false;
      }
    } catch (error) {
      const err = error as Error;
      print(`  ${symbols.error} Installation error: ${err.message}`, 'red');
      if (log) {
        log(`  Installation ERROR - ${err.message}`);
      }
      return false;
    }
  } else {
    print(`  ${symbols.warning} Installation skipped by user`, 'yellow');
    if (log) {
      log(`Installation skipped by user`);
    }
    return false;
  }
}

/**
 * Create check command function for processCheck
 */
export function createCheckCommandFunction(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void,
  autoYes = false
): CheckCommandFunction {
  return async function checkCommand(item: CheckItem, context: string | null = null, skipInstall = false): Promise<CheckResult> {
    const { name, description, test, install } = item;
    const contextSuffix = context ? ` [${context}]` : '';
    
    print(`Checking ${name}${contextSuffix}...`, 'cyan');
    if (log) {
      log(`Checking command: ${name} (${description})`);
    }
    
    // Read .env file for variable substitution
    const envFile = path.join(workspaceRoot, '.env');
    const env = readEnvFile(envFile);
    
    // Default test for MCP checks: if no explicit test provided, verify MCP via tools/list
    let effectiveTest = test;
    if ((!effectiveTest || typeof effectiveTest !== 'string' || !effectiveTest.trim()) && item.mcpSettings && name) {
      effectiveTest = `node "${path.join(projectRoot, 'scripts', 'test-mcp.js')}" "${name}"`;
    }
    
    // If no test command, skip verification
    if (!effectiveTest) {
      print(`${symbols.warning} ${name} - No test command specified`, 'yellow');
      if (description) {
        print(description, 'yellow');
      }
      if (log) {
        log(`No test command specified for ${name}`);
      }
      return {
        name: name,
        passed: false,
        version: null,
        note: 'No test command specified'
      };
    }
    
    // Replace variables in test and install commands
    const testWithVars = replaceVariables(effectiveTest, env);
    const installWithVars = install ? replaceVariables(install, env) : install;
    
    try {
      // Check if test is a file path or a command
      if (isFilePath(testWithVars)) {
        // It's a file/directory path - check if it exists
        if (log) {
          log(`File/directory path: ${testWithVars}`);
        }
        
        const fileCheck = checkFileExists(testWithVars, projectRoot);
        
        if (fileCheck.exists && (fileCheck.isFile || fileCheck.isDirectory)) {
          const typeLabel = fileCheck.isDirectory ? 'Directory' : 'File';
          print(`${symbols.success} ${name} - OK`, 'green');
          if (log) {
            log(`Result: SUCCESS - ${typeLabel} exists: ${fileCheck.path}`);
          }
          
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
          if (log) {
            log(`Result: FAILED - Path not found: ${fileCheck.path}`);
          }
          
          // If install command is available, offer to install (unless skipInstall is true)
          if (installWithVars && !skipInstall) {
            // Create item with replaced variables for installation
            const itemWithVars = { ...item, install: installWithVars };
            const installed = await installSoftware(itemWithVars, workspaceRoot, log, autoYes);
            
            if (installed) {
              // Re-check after installation
              print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
              if (log) {
                log(`Re-checking ${name} after installation`);
              }
              
              const recheckFile = checkFileExists(testWithVars, projectRoot);
              
              if (recheckFile.exists && (recheckFile.isFile || recheckFile.isDirectory)) {
                const typeLabel = recheckFile.isDirectory ? 'Directory' : 'File';
                print(`${symbols.success} ${name} - OK`, 'green');
                if (log) {
                  log(`Re-check SUCCESS - ${typeLabel} exists: ${recheckFile.path}`);
                }
                
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
                if (log) {
                  log(`Re-check FAILED - Installation may have succeeded but path not found`);
                }
                
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
        if (log) {
          log(`Command: ${testWithVars}`);
        }
        
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
        const projectsDir = path.join(workspaceRoot, 'projects');
        if (apiCommandHandled) {
          // API commands should run from workspace root
          execOptions.cwd = workspaceRoot || process.cwd();
        } else if (context) {
          const projectCwd = path.join(projectsDir, context);
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
          if (log) {
            log(`Result: SUCCESS - Version: ${version}`);
          }
          
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
          if (log) {
            log(`Result: FAILED - ${errorLabel}${result.error ? ` (${result.error})` : ''}`);
          }
          
          // If install command is available, offer to install (unless skipInstall is true)
          if (install && !skipInstall) {
            const itemWithCwd = { ...item, _execCwd: execOptions.cwd };
            const installed = await installSoftware(itemWithCwd, workspaceRoot, log, autoYes);
            
            if (installed) {
              // Re-check after installation
              print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
              if (log) {
                log(`Re-checking ${name} after installation`);
              }
              
              const recheckResult = isSudo ? executeInteractiveCommand(command) : executeCommand(command, execOptions);
              
              if (recheckResult.success) {
                // For test-type checks or auth checks with test commands that produce no output,
                // show "OK" instead of "unknown" to indicate the check passed
                const isTestCheck = item.type === 'test' || (item.type === 'auth' && item.test);
                const version = isSudo 
                  ? 'passed' 
                  : (recheckResult.output || (isTestCheck ? 'OK' : 'unknown'));
                print(`${symbols.success} ${name} - ${version}`, 'green');
                if (log) {
                  log(`Re-check SUCCESS - Version: ${version}`);
                }
                
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
                if (log) {
                  log(`Re-check FAILED - ${retryErrorLabel}`);
                }
                
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
      if (log) {
        log(`Result: ERROR - ${err.message}`);
      }
      
      return {
        name: name,
        passed: false,
        version: null
      };
    }
  };
}

/**
 * Create HTTP access check function for processCheck
 */
export function createCheckHttpAccessFunction(
  workspaceRoot: string,
  log?: (message: string) => void
): CheckHttpAccessFunction {
  return async function checkHttpAccess(item: CheckItem, context: string | null = null): Promise<CheckResult> {
    const { name, description, test } = item;
    const contextSuffix = context ? ` [${context}]` : '';
    
    print(`Checking ${name}${contextSuffix}...`, 'cyan');
    if (log) {
      log(`Checking HTTP access: ${name} (${description})`);
      log(`Request: ${test}`);
    }
    
    try {
      // Parse "GET https://..." format
      const parts = test?.trim().split(/\s+/) || [];
      const method = parts[0] || 'GET';
      const url = parts.slice(1).join(' ');
      
      if (!url) {
        throw new Error('Invalid test format: missing URL');
      }
      
      // Build headers
      const headers: Record<string, string> = {
        'User-Agent': 'devduck-install'
      };
      
      // Check if check has var property and we need to add auth header
      const envFile = path.join(workspaceRoot, '.env');
      const env = readEnvFile(envFile);
      const checkVar = (item as { var?: string }).var;
      if (checkVar) {
        const token = process.env[checkVar] || env[checkVar];
        if (token) {
          // Use Bearer token for non-GitHub APIs
          headers['Authorization'] = `Bearer ${token}`;
        }
      }
      
      const result = await makeHttpRequest(method, url, headers);
      
      if (result.success) {
        print(`${symbols.success} ${name} - OK`, 'green');
        if (log) {
          log(`Result: SUCCESS - Status: ${result.statusCode}`);
        }
        
        return {
          name: name,
          passed: true,
          statusCode: result.statusCode ?? undefined
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
        if (log) {
          log(`Result: FAILED - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
        }
        
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
      if (log) {
        log(`Result: ERROR - ${err.message}`);
      }
      
      return {
        name: name,
        passed: false,
        error: err.message
      };
    }
  };
}

/**
 * Create replace variables function for processCheck
 */
export function createReplaceVariablesFunction(): ReplaceVariablesFunction {
  return function replaceVariablesInObjectWithLog(obj: unknown, env: Record<string, string>): unknown {
    return replaceVariablesInObject(obj, env);
  };
}

/**
 * Create all check functions for processCheck
 */
export function createCheckFunctions(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void,
  autoYes = false
): {
  checkCommand: CheckCommandFunction;
  checkHttpAccess: CheckHttpAccessFunction;
  isHttpRequest: IsHttpRequestFunction;
  replaceVariablesInObjectWithLog: ReplaceVariablesFunction;
} {
  return {
    checkCommand: createCheckCommandFunction(workspaceRoot, projectRoot, log, autoYes),
    checkHttpAccess: createCheckHttpAccessFunction(workspaceRoot, log),
    isHttpRequest: isHttpRequest,
    replaceVariablesInObjectWithLog: createReplaceVariablesFunction()
  };
}

/**
 * Load modules for checks from all sources
 */
export async function loadModulesForChecks(
  workspaceRoot: string,
  config: Record<string, unknown>
): Promise<Array<{
  name: string;
  path: string;
  checks?: Array<{ name?: string; type?: string; var?: string; description?: string; optional?: boolean; test?: string; install?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}>> {
  const { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies, loadModuleFromPath } = await import('./module-resolver.js');
  const { loadModulesFromRepo, getDevduckVersion } = await import('../lib/repo-modules.js');
  const { loadModuleResources } = await import('./module-loader.js');
  
  // Load external modules from repos
  const externalModules: Array<{ name: string; path: string; checks?: unknown[]; [key: string]: unknown }> = [];
  if (config.repos && Array.isArray(config.repos)) {
    const devduckVersion = getDevduckVersion();
    
    for (const repoUrl of config.repos) {
      try {
        const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
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
        // Skip failed repos
        const err = error as Error;
        console.warn(`Warning: Failed to load modules from ${repoUrl}: ${err.message}`);
      }
    }
  }
  
  // Load all modules with priority: workspace > projects > external > built-in
  const localModules = getAllModules();
  const workspaceModulesDir = path.join(workspaceRoot, 'modules');
  const workspaceModules = getAllModulesFromDirectory(workspaceModulesDir);
  
  const projectsModules: Array<{ name: string; path: string; checks?: unknown[]; [key: string]: unknown }> = [];
  if (config.projects && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      if (typeof project !== 'object' || project === null) continue;
      const projectObj = project as { src?: string };
      const projectName = projectObj.src ? String(projectObj.src).split('/').pop()?.replace(/\.git$/, '') || '' : '';
      const projectPath = path.join(workspaceRoot, 'projects', projectName);
      const projectModulesDir = path.join(projectPath, 'modules');
      if (fs.existsSync(projectModulesDir)) {
        const projectModules = getAllModulesFromDirectory(projectModulesDir);
        projectsModules.push(...projectModules);
      }
    }
  }
  
  const allModules = [...workspaceModules, ...projectsModules, ...externalModules, ...localModules];
  const moduleNames = expandModuleNames(Array.isArray(config.modules) ? config.modules : ['*'], allModules);
  const resolvedModules = resolveDependencies(moduleNames, allModules);
  
  // Load module resources
  const loadedModules = resolvedModules.map(module => {
    const resources = loadModuleResources(module);
    return {
      ...resources,
      checks: module.checks
    };
  });
  
  return loadedModules;
}

/**
 * Load projects for checks from config
 */
export function loadProjectsForChecks(
  workspaceRoot: string,
  config: Record<string, unknown>
): Array<{
  src?: string;
  checks?: Array<{ name?: string; type?: string; var?: string; description?: string; optional?: boolean; [key: string]: unknown }>;
  [key: string]: unknown;
}> {
  if (!config.projects || !Array.isArray(config.projects)) {
    return [];
  }
  
  return config.projects as Array<{
    src?: string;
    checks?: Array<{ name?: string; type?: string; var?: string; description?: string; optional?: boolean; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
}

