#!/usr/bin/env node

/**
 * Pre-install check for required tokens
 * 
 * Collects auth checks from projects and modules, verifies tokens are present,
 * and runs test checks to validate token functionality.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';
import { readJSON, writeJSON } from '../lib/config.js';
import { readEnvFile } from '../lib/env.js';
import { writeEnvFile } from './env.js';
import {
  expandModuleNames,
  getAllModules,
  getAllModulesFromDirectory,
  loadModuleFromPath,
  type Module,
  type ModuleCheck
} from './module-resolver.js';

interface AuthCheckResult {
  type: string;
  var?: string;
  name?: string;
  description?: string;
  test?: string;
  optional?: boolean;
  install?: string;
  docs?: string;
  present?: boolean;
  passed?: boolean;
  error?: string;
  [key: string]: unknown;
}

interface ProjectCheckResult {
  name: string;
  checks: AuthCheckResult[];
}

interface ModuleCheckResult {
  name: string;
  checks: AuthCheckResult[];
}

interface PreInstallCheckResult {
  projects: ProjectCheckResult[];
  modules: ModuleCheckResult[];
}

interface HttpRequestResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  body: string | null;
  timeout?: boolean;
}

/**
 * Make HTTP request with custom headers
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
        const statusCode = res.statusCode ?? null;
        // Consider 2xx as success
        const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;
        
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
 * Check if environment variable exists and is not empty
 */
function checkEnvVar(varName: string, env: Record<string, string>): boolean {
  const value = process.env[varName] || env[varName];
  return value !== undefined && String(value).trim() !== '';
}

/**
 * Check if test string is an HTTP request
 */
function isHttpRequest(test: string | undefined): boolean {
  if (!test) return false;
  const trimmed = test.trim();
  return /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+https?:\/\//i.test(trimmed);
}

/**
 * Check if test string is a curl command
 */
function isCurlCommand(test: string | undefined): boolean {
  if (!test) return false;
  const trimmed = test.trim();
  return trimmed.startsWith('curl ');
}

/**
 * Replace environment variables in command string ($VAR_NAME format)
 */
function replaceEnvVarsInCommand(command: string, env: Record<string, string>): string {
  return command.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
    const value = process.env[varName] || env[varName];
    return value !== undefined ? value : match;
  });
}

/**
 * Execute test check (HTTP request or curl command)
 */
async function executeTestCheck(check: ModuleCheck, env: Record<string, string>): Promise<AuthCheckResult> {
  const result: AuthCheckResult = {
    type: check.type,
    name: check.name,
    description: check.description,
    test: check.test
  };

  if (!check.test) {
    result.passed = false;
    result.error = 'No test specified';
    return result;
  }

  // Handle generic shell commands (sh -c '...' etc.)
  // Note: this is intentionally allowed for module "test" checks (e.g., verifying CLIs),
  // not just curl/HTTP auth validation.
  const executeShellCommand = (command: string): AuthCheckResult => {
    try {
      const output = execSync(command, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/bash',
        timeout: 20000
      });
      result.passed = true;
      // Keep output out of result unless needed; callers only care pass/fail.
      void output;
      return result;
    } catch (error) {
      const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; status?: number };
      result.passed = false;
      const stderrStr = err.stderr ? err.stderr.toString().trim() : '';
      const stdoutStr = err.stdout ? err.stdout.toString().trim() : '';
      result.error = stderrStr || stdoutStr || err.message || 'Command failed';
      return result;
    }
  };

  // Handle curl commands
  if (isCurlCommand(check.test)) {
    try {
      // Replace environment variables in curl command
      const command = replaceEnvVarsInCommand(check.test, env);
      
      // Execute curl command
      const output = execSync(command, { 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000
      });
      
      // Check if curl returned HTTP status code (if using -w '%{http_code}')
      const statusCode = output.trim();
      if (/^\d{3}$/.test(statusCode)) {
        // Status code returned, check if it's 2xx
        const code = parseInt(statusCode, 10);
        result.passed = code >= 200 && code < 300;
        if (!result.passed) {
          result.error = `HTTP ${code}`;
        }
      } else {
        // No status code in output, assume success if curl exited with 0
        result.passed = true;
      }
      
      return result;
    } catch (error) {
      const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; status?: number };
      result.passed = false;
      
      // Try to extract HTTP status code from stdout (curl might return it even on error)
      let statusCode: number | null = null;
      if (err.stdout) {
        const stdoutStr = err.stdout.toString().trim();
        if (/^\d{3}$/.test(stdoutStr)) {
          statusCode = parseInt(stdoutStr, 10);
        }
      }
      
      // Build error message with status code if available
      if (statusCode !== null) {
        result.error = `HTTP ${statusCode}`;
      } else {
        const errorMsg = err.stderr ? err.stderr.toString().trim() : err.message || 'Command failed';
        result.error = errorMsg;
      }
      
      return result;
    }
  }

  // Handle HTTP requests (GET https://... format)
  if (!isHttpRequest(check.test)) {
    // Not HTTP or curl: treat as a shell command.
    const command = replaceEnvVarsInCommand(check.test, env);
    return executeShellCommand(command);
  }

  try {
    // Parse "GET https://..." format
    const parts = check.test.trim().split(/\s+/);
    const method = parts[0] || 'GET';
    const url = parts.slice(1).join(' ');
    
    if (!url) {
      result.passed = false;
      result.error = 'Invalid test format: missing URL';
      return result;
    }

    // Build headers
    const headers: Record<string, string> = {
      'User-Agent': 'devduck-pre-install-check'
    };

    // Check if check has var property and we need to add auth header
    if (check.var) {
      const token = process.env[check.var] || env[check.var];
      if (token) {
        // Use Bearer token for non-GitHub APIs
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const httpResult = await makeHttpRequest(method, url, headers);
    
    result.passed = httpResult.success;
    if (!httpResult.success) {
      result.error = httpResult.error || `HTTP ${httpResult.statusCode}`;
    }

    return result;
  } catch (error) {
    const err = error as Error;
    result.passed = false;
    result.error = err.message;
    return result;
  }
}

/**
 * Collect checks from projects in workspace.config.json
 */
function collectProjectChecks(_workspaceRoot: string, config: Record<string, unknown>): ProjectCheckResult[] {
  const results: ProjectCheckResult[] = [];
  
  if (!config.projects || !Array.isArray(config.projects)) {
    return results;
  }

  for (const project of config.projects) {
    if (typeof project !== 'object' || project === null) continue;
    
    const projectObj = project as Record<string, unknown>;
    const projectName = projectObj.src ? String(projectObj.src).split('/').pop()?.replace(/\.git$/, '') || 'unknown' : 'unknown';
    
    if (!projectObj.checks || !Array.isArray(projectObj.checks)) {
      continue;
    }

    const authChecks: AuthCheckResult[] = [];
    for (const check of projectObj.checks) {
      if (typeof check !== 'object' || check === null) continue;
      const checkObj = check as Record<string, unknown>;
      if (checkObj.type === 'auth') {
        authChecks.push({
          type: 'auth',
          var: checkObj.var ? String(checkObj.var) : undefined,
          description: checkObj.description ? String(checkObj.description) : undefined
        });
      }
    }

    if (authChecks.length > 0) {
      results.push({
        name: projectName,
        checks: authChecks
      });
    }
  }

  return results;
}

/**
 * Collect checks from all modules
 */
async function collectModuleChecks(
  workspaceRoot: string,
  config: Record<string, unknown>
): Promise<ModuleCheckResult[]> {
  const results: ModuleCheckResult[] = [];
  
  // Load local modules
  const localModules = getAllModules();
  
  // Load external modules from repos
  const externalModules: Module[] = [];
  if (config.repos && Array.isArray(config.repos)) {
    const { loadModulesFromRepo, getDevduckVersion } = await import('../lib/repo-modules.js');
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
  
  // Load workspace modules
  const workspaceModulesDir = path.join(workspaceRoot, 'modules');
  const workspaceModules = getAllModulesFromDirectory(workspaceModulesDir);
  
  // Load project modules
  const projectsModules: Module[] = [];
  if (config.projects && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      if (typeof project !== 'object' || project === null) continue;
      const projectObj = project as Record<string, unknown>;
      const projectName = projectObj.src ? String(projectObj.src).split('/').pop()?.replace(/\.git$/, '') || '' : '';
      const projectPath = path.join(workspaceRoot, 'projects', projectName);
      const projectModulesDir = path.join(projectPath, 'modules');
      if (fs.existsSync(projectModulesDir)) {
        const projectModules = getAllModulesFromDirectory(projectModulesDir);
        projectsModules.push(...projectModules);
      }
    }
  }
  
  // Combine all modules with explicit priority (first occurrence wins):
  // 1) workspace modules, 2) project modules, 3) external repos, 4) built-in devduck modules.
  const allModules = [...workspaceModules, ...projectsModules, ...externalModules, ...localModules];
  
  // Resolve which modules to check based on config
  const moduleNames: string[] = expandModuleNames(Array.isArray(config.modules) ? config.modules : ['*'], allModules);
  
  // Get unique modules by name (first occurrence wins)
  const moduleMap = new Map<string, Module>();
  for (const module of allModules) {
    if (!moduleMap.has(module.name) && moduleNames.includes(module.name)) {
      moduleMap.set(module.name, module);
    }
  }
  
  // Extract checks from modules
  for (const module of moduleMap.values()) {
    if (!module.checks || module.checks.length === 0) {
      continue;
    }
    
    const moduleChecks: AuthCheckResult[] = [];
    for (const check of module.checks) {
      if (check.type === 'auth' || check.type === 'test') {
        moduleChecks.push({
          type: check.type,
          var: check.var,
          name: check.name,
          description: check.description,
          test: check.test,
          optional: (check as { optional?: boolean }).optional === true,
          install: (check as { install?: string }).install,
          docs: (check as { docs?: string }).docs
        });
      }
    }
    
    if (moduleChecks.length > 0) {
      results.push({
        name: module.name,
        checks: moduleChecks
      });
    }
  }
  
  return results;
}

/**
 * Run pre-install checks
 */
export async function runPreInstallChecks(workspaceRoot: string): Promise<PreInstallCheckResult> {
  const configPath = path.join(workspaceRoot, 'workspace.config.json');
  const envPath = path.join(workspaceRoot, '.env');
  const cacheDir = path.join(workspaceRoot, '.cache');
  const resultPath = path.join(cacheDir, 'pre-install-check.json');
  
  // Ensure cache directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  // Read config
  const config = readJSON<Record<string, unknown>>(configPath);
  if (!config) {
    throw new Error(`Cannot read workspace.config.json at ${configPath}`);
  }
  
  // Read env
  const env = readEnvFile(envPath);
  
  // Collect checks from projects
  const projectResults = collectProjectChecks(workspaceRoot, config);
  
  // Collect checks from modules
  const moduleResults = await collectModuleChecks(workspaceRoot, config);
  
  // Check auth tokens
  for (const projectResult of projectResults) {
    for (const check of projectResult.checks) {
      if (check.type === 'auth' && check.var) {
        check.present = checkEnvVar(check.var, env);
      }
    }
  }
  
  for (const moduleResult of moduleResults) {
    for (const check of moduleResult.checks) {
      if (check.type === 'auth' && check.var) {
        check.present = checkEnvVar(check.var, env);
        
        // If auth check has test field, execute it only if token is present
        if (check.test) {
          if (!check.present) {
            // Don't execute test if token is missing - test will be skipped
            // The missing token will be reported separately, no need to set passed/error
          } else {
            // Execute test check only if token is present
            const testCheck = await executeTestCheck(check as ModuleCheck, env);
            check.passed = testCheck.passed;
            check.error = testCheck.error;
          }
        }
      } else if (check.type === 'test') {
        // Check if required token is present before running test
        const testCheckObj = check as ModuleCheck;
        if (testCheckObj.var) {
          const tokenPresent = checkEnvVar(testCheckObj.var, env);
          if (!tokenPresent) {
            // If install command is available, try to run it to get the value
            if (testCheckObj.install && typeof testCheckObj.install === 'string') {
              try {
                const installCommand = replaceEnvVarsInCommand(testCheckObj.install, env);
                const installOutput = execSync(installCommand, {
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  shell: '/bin/bash',
                  timeout: 20000
                }).trim();
                
                if (installOutput) {
                  // Set the variable in env for this check
                  env[testCheckObj.var] = installOutput;
                  // Also set in process.env for the test execution
                  process.env[testCheckObj.var] = installOutput;
                  
                  // Write to .env file to persist the variable
                  const envPath = path.join(workspaceRoot, '.env');
                  const existingEnv = readEnvFile(envPath);
                  existingEnv[testCheckObj.var] = installOutput;
                  writeEnvFile(envPath, existingEnv);
                  
                  // Now execute the test check with the variable set
                  const testCheck = await executeTestCheck(testCheckObj, env);
                  check.passed = testCheck.passed;
                  check.error = testCheck.error;
                } else {
                  check.passed = false;
                  check.error = `Required token ${testCheckObj.var} is not present and install command returned empty output`;
                }
              } catch (error) {
                const err = error as { message?: string; stderr?: Buffer | string };
                check.passed = false;
                check.error = `Required token ${testCheckObj.var} is not present and install command failed: ${err.message || 'Command failed'}`;
              }
            } else {
              check.passed = false;
              check.error = `Required token ${testCheckObj.var} is not present`;
            }
          } else {
            // Token is present - execute test check first
            let testCheck = await executeTestCheck(testCheckObj, env);
            
            // If test fails and install command is available, try running install first
            if (!testCheck.passed && testCheckObj.install && typeof testCheckObj.install === 'string') {
              try {
                const installCommand = replaceEnvVarsInCommand(testCheckObj.install, env);
                const installOutput = execSync(installCommand, {
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  shell: '/bin/bash',
                  timeout: 60000 // Longer timeout for compilation
                }).trim();
                
                // If install command outputs a value, update the variable
                if (installOutput && installOutput !== env[testCheckObj.var]) {
                  env[testCheckObj.var] = installOutput;
                  process.env[testCheckObj.var] = installOutput;
                  
                  // Write to .env file to persist the variable
                  const envPath = path.join(workspaceRoot, '.env');
                  const existingEnv = readEnvFile(envPath);
                  existingEnv[testCheckObj.var] = installOutput;
                  writeEnvFile(envPath, existingEnv);
                }
                
                // Re-run the test check after install
                testCheck = await executeTestCheck(testCheckObj, env);
              } catch (error) {
                const err = error as { message?: string; stderr?: Buffer | string };
                // If install fails, keep the original test error but add install error info
                testCheck.passed = false;
                testCheck.error = testCheck.error 
                  ? `${testCheck.error} (install also failed: ${err.message || 'Command failed'})`
                  : `Install command failed: ${err.message || 'Command failed'}`;
              }
            }
            
            check.passed = testCheck.passed;
            check.error = testCheck.error;
          }
        } else {
          // Execute test check even without var (for tests that don't require tokens)
          let testCheck = await executeTestCheck(testCheckObj, env);
          
          // If test fails and install command is available, try running install first
          if (!testCheck.passed && testCheckObj.install && typeof testCheckObj.install === 'string') {
            try {
              const installCommand = replaceEnvVarsInCommand(testCheckObj.install, env);
              execSync(installCommand, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: '/bin/bash',
                timeout: 60000 // Longer timeout for compilation
              });
              
              // Re-run the test check after install
              testCheck = await executeTestCheck(testCheckObj, env);
            } catch (error) {
              // If install fails, keep the original test error but add install error info
              const err = error as { message?: string };
              testCheck.passed = false;
              testCheck.error = testCheck.error 
                ? `${testCheck.error} (install also failed: ${err.message || 'Command failed'})`
                : `Install command failed: ${err.message || 'Command failed'}`;
            }
          }
          
          check.passed = testCheck.passed;
          check.error = testCheck.error;
        }
      }
    }
  }
  
  const result: PreInstallCheckResult = {
    projects: projectResults,
    modules: moduleResults
  };
  
  // Save results
  writeJSON(resultPath, result);
  
  return result;
}

/**
 * Check pre-install check results and return the validation status.
 *
 * Important: this function must NOT terminate the process. Callers decide whether to exit.
 */
export type PreInstallValidationStatus = 'ok' | 'needs_input' | 'failed';

export function validatePreInstallChecks(
  checkResults: PreInstallCheckResult,
  options: {
    print: (message: string, color?: string | 'reset' | 'green' | 'red' | 'yellow' | 'cyan' | 'blue') => void;
    log: (message: string) => void;
    symbols: {
      success: string;
      error: string;
      info: string;
    };
  }
): PreInstallValidationStatus {
  const { print, log, symbols } = options;

  const isRequiredTokenMissingError = (err: string | undefined): boolean => {
    if (!err) return false;
    return /^Required token [A-Za-z_][A-Za-z0-9_]* is not present$/.test(err.trim());
  };
  
  // Show successful auth token checks
  for (const project of checkResults.projects) {
    for (const check of project.checks) {
      if (check.type === 'auth' && check.present && check.var) {
        const desc = check.description ? ` (${check.description})` : '';
        print(`  ${symbols.success} ${check.var}${desc} - token exist`, 'green');
      }
    }
  }
  
  for (const module of checkResults.modules) {
    for (const check of module.checks) {
      if (check.type === 'auth' && check.present && check.var) {
        const desc = check.description ? ` (${check.description})` : '';
        const moduleName = module.name ? ` (module: ${module.name})` : '';
        print(`  ${symbols.success} ${check.var}${desc}${moduleName} - token exist`, 'green');
        // If test was executed and passed, show success
        if (check.test && check.passed === true) {
          print(`    ${symbols.success} Test check passed`, 'green');
        }
      }
    }
  }
  
  // Check for missing auth tokens
  let hasMissingAuth = false;
  const missingAuth: string[] = [];
  
  for (const project of checkResults.projects) {
    for (const check of project.checks) {
      if (check.type === 'auth' && !check.present) {
        hasMissingAuth = true;
        if (check.var) {
          const desc = check.description ? ` - ${check.description}` : '';
          missingAuth.push(`${check.var} (project: ${project.name})${desc}`);
        }
      }
    }
  }
  
  for (const module of checkResults.modules) {
    for (const check of module.checks) {
      if (check.type === 'auth' && !check.present && check.optional !== true) {
        hasMissingAuth = true;
        if (check.var) {
          const desc = check.description ? ` - ${check.description}` : '';
          missingAuth.push(`${check.var} (module: ${module.name})${desc}`);
        }
      }
    }
  }
  
  // Check for failed test checks (both standalone test checks and test within auth checks)
  let hasFailedTests = false;
  const tokenBlockedTests: Array<{ name: string; error?: string }> = [];
  const realFailedTests: Array<{ name: string; error?: string }> = [];
  
  for (const module of checkResults.modules) {
    for (const check of module.checks) {
      // Check standalone test checks
      if (check.type === 'test' && check.passed === false && check.optional !== true) {
        hasFailedTests = true;
        const checkName = check.name || check.test || 'unknown';
        const entry = { name: `${checkName} (module: ${module.name})`, error: check.error };
        if (isRequiredTokenMissingError(check.error)) {
          tokenBlockedTests.push(entry);
        } else {
          realFailedTests.push(entry);
        }
        if (check.error) {
          log(`Test check failed: ${checkName} - ${check.error}`);
        }
      }
      // Check test within auth checks (only if test was actually executed, i.e. passed is defined)
      if (check.type === 'auth' && check.test && check.passed !== undefined && check.passed === false && check.optional !== true) {
        hasFailedTests = true;
        const checkName = check.name || check.test || `${check.var} test`;
        realFailedTests.push({ name: `${checkName} (module: ${module.name})`, error: check.error });
        if (check.error) {
          log(`Auth test check failed: ${checkName} - ${check.error}`);
        }
      }
    }
  }

  if (hasMissingAuth || hasFailedTests) {
    // If there are real failures (not just missing tokens), keep the old "hard fail" behavior.
    if (realFailedTests.length > 0) {
      print(`\n${symbols.error} Pre-install checks failed!`, 'red');
      if (hasMissingAuth) {
        print(`  Missing required tokens:`, 'red');
        for (const module of checkResults.modules) {
          for (const check of module.checks) {
            if (check.type === 'auth' && !check.present && check.optional !== true && check.var) {
              const desc = check.description ? ` - ${check.description}` : '';
              const docs = check.docs ? `\n      ${check.docs}` : '';
              print(`    - ${check.var} (module: ${module.name})${desc}${docs}`, 'red');
            }
          }
        }
        for (const project of checkResults.projects) {
          for (const check of project.checks) {
            if (check.type === 'auth' && !check.present && check.var) {
              const desc = check.description ? ` - ${check.description}` : '';
              const docs = check.docs ? `\n      ${check.docs}` : '';
              print(`    - ${check.var} (project: ${project.name})${desc}${docs}`, 'red');
            }
          }
        }
      }
      print(`  Failed test checks:`, 'red');
      for (const test of realFailedTests) {
        if (test.error) {
          print(`    - ${test.name} - ${test.error}`, 'red');
        } else {
          print(`    - ${test.name}`, 'red');
        }
      }
      if (tokenBlockedTests.length > 0) {
        print(`  Token-dependent checks blocked:`, 'yellow');
        for (const test of tokenBlockedTests) {
          if (test.error) {
            print(`    - ${test.name} - ${test.error}`, 'yellow');
          } else {
            print(`    - ${test.name}`, 'yellow');
          }
        }
      }
      print(`\n${symbols.info} Please set missing tokens in .env file or environment variables`, 'cyan');
      print(`${symbols.info} Results saved to .cache/pre-install-check.json`, 'cyan');
      log(`Pre-install checks failed: real test failures detected`);
      return 'failed';
    }

    // Missing-token-only case: not a crash. Ask the user to provide tokens and rerun install.
    print(`\n${symbols.info} Pre-install checks require your input`, 'yellow');
    if (hasMissingAuth) {
      print(`  Missing required tokens:`, 'yellow');
      for (const module of checkResults.modules) {
        for (const check of module.checks) {
          if (check.type === 'auth' && !check.present && check.optional !== true && check.var) {
            const desc = check.description ? ` - ${check.description}` : '';
            const docs = check.docs ? `\n      ${check.docs}` : '';
            print(`    - ${check.var} (module: ${module.name})${desc}${docs}`, 'yellow');
          }
        }
      }
      for (const project of checkResults.projects) {
        for (const check of project.checks) {
          if (check.type === 'auth' && !check.present && check.var) {
            const desc = check.description ? ` - ${check.description}` : '';
            const docs = check.docs ? `\n      ${check.docs}` : '';
            print(`    - ${check.var} (project: ${project.name})${desc}${docs}`, 'yellow');
          }
        }
      }
    }
    if (tokenBlockedTests.length > 0) {
      print(`  Token-dependent checks blocked:`, 'yellow');
      for (const test of tokenBlockedTests) {
        if (test.error) {
          print(`    - ${test.name} - ${test.error}`, 'yellow');
        } else {
          print(`    - ${test.name}`, 'yellow');
        }
      }
    }
    print(`\n${symbols.info} Set these tokens in .env (or env vars) and re-run: npm run install`, 'cyan');
    print(`${symbols.info} Results saved to .cache/pre-install-check.json`, 'cyan');
    log(`Pre-install checks require user input: missing tokens`);
    return 'needs_input';
  }
  
  print(`  ${symbols.success} All pre-install checks passed`, 'green');
  log(`Pre-install checks passed`);
  return 'ok';
}

