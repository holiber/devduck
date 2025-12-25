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
import { findWorkspaceRoot } from '../lib/workspace-root.js';
import {
  expandModuleNames,
  getAllModules,
  getAllModulesFromDirectory,
  loadModuleFromPath,
  type Module,
  type ModuleCheck
} from './module-resolver.js';
import { processCheck } from './process-check.js';
import type { CheckItem, CheckResult } from './types.js';

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
  modulePath?: string;
}

interface PreInstallCheckResult {
  arcadiaRoot?: string;
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
        // Consider 2xx as success.
        // Also treat 429 as "token is valid but rate-limited" for cheap auth probes like GET /models.
        const isSuccess =
          statusCode !== null &&
          ((statusCode >= 200 && statusCode < 300) || statusCode === 429);
        
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
 * Resolve tsx command with module-relative path
 * Handles commands like "tsx scripts/install-proxy-client.ts" by resolving relative to module path
 */
function resolveTsxCommand(command: string, modulePath?: string): string {
  const trimmed = command.trim();
  
  // Check if command starts with "tsx " or "npx tsx "
  if (trimmed.startsWith('tsx ')) {
    const scriptPath = trimmed.substring(4).trim();
    
    // If it's an absolute path, use as-is
    if (path.isAbsolute(scriptPath)) {
      return `npx tsx ${scriptPath}`;
    }
    
    // If module path is provided, resolve relative to module
    if (modulePath) {
      const resolvedPath = path.resolve(modulePath, scriptPath);
      if (fs.existsSync(resolvedPath)) {
        return `npx tsx ${resolvedPath}`;
      }
    }
    
    // Fallback: try to find the script in workspace
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    if (workspaceRoot) {
      // Search in common module locations
      const searchPaths = [
        path.join(workspaceRoot, 'modules'),
        path.join(workspaceRoot, 'devduck'),
        path.join(workspaceRoot, 'projects')
      ];
      
      for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
          const found = findScriptInDirectory(searchPath, scriptPath);
          if (found) {
            return `npx tsx ${found}`;
          }
        }
      }
    }
    
    // If not found, return as-is (will fail with clear error)
    return `npx tsx ${scriptPath}`;
  }
  
  // Not a tsx command, return as-is
  return command;
}

/**
 * Recursively find script in directory
 */
function findScriptInDirectory(dir: string, scriptName: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isFile() && entry.name === scriptName) {
        return fullPath;
      }
      
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const found = findScriptInDirectory(fullPath, scriptName);
        if (found) {
          return found;
        }
      }
    }
  } catch {
    // Ignore errors
  }
  
  return null;
}

/**
 * Wrapper for checkCommand that handles special cases (api commands, curl commands)
 */
async function checkCommandWrapper(item: CheckItem, _context: string | null = null, _skipInstall = false): Promise<CheckResult> {
  const { name, test } = item;
  
  if (!test) {
    return {
      name: name,
      passed: false,
      error: 'No test specified'
    };
  }
  
  // Handle API calls (commands starting with "api ")
  if (test.trim().startsWith('api ')) {
    try {
      const apiCommand = test.trim().substring(4); // Remove "api " prefix
      const command = `npm run call -- ${apiCommand}`;
      
      const output = execSync(command, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/bash',
        timeout: 30000,
        cwd: findWorkspaceRoot(process.cwd()) || process.cwd()
      });
      
      const resultValue = output.trim().split('\n').pop()?.trim() || '';
      
      if (resultValue === 'true') {
        return {
          name: name,
          passed: true
        };
      } else {
        return {
          name: name,
          passed: false,
          error: `api ${apiCommand} returned ${resultValue}`
        };
      }
    } catch (error) {
      const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
      const stderrStr = err.stderr ? err.stderr.toString().trim() : '';
      const stdoutStr = err.stdout ? err.stdout.toString().trim() : '';
      const apiCommand = test.trim().substring(4);
      return {
        name: name,
        passed: false,
        error: stderrStr || stdoutStr || err.message || `api ${apiCommand} failed`
      };
    }
  }
  
  // Handle curl commands
  if (isCurlCommand(test)) {
    try {
      const env = readEnvFile(path.join(findWorkspaceRoot(process.cwd()) || process.cwd(), '.env'));
      const command = replaceEnvVarsInCommand(test, env);
      
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
        // Treat 429 as "valid but rate-limited" for cheap auth probes.
        const passed = (code >= 200 && code < 300) || code === 429;
        return {
          name: name,
          passed: passed,
          error: passed ? undefined : `HTTP ${code}`
        };
      } else {
        // No status code in output, assume success if curl exited with 0
        return {
          name: name,
          passed: true
        };
      }
    } catch (error) {
      const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; status?: number };
      
      // Try to extract HTTP status code from stdout (curl might return it even on error)
      let statusCode: number | null = null;
      if (err.stdout) {
        const stdoutStr = err.stdout.toString().trim();
        if (/^\d{3}$/.test(stdoutStr)) {
          statusCode = parseInt(stdoutStr, 10);
        }
      }
      
      // Build error message with status code if available
      const errorMsg = statusCode !== null 
        ? `HTTP ${statusCode}`
        : (err.stderr ? err.stderr.toString().trim() : err.message || 'Command failed');
      
      return {
        name: name,
        passed: false,
        error: errorMsg
      };
    }
  }
  
  // For other commands, use a simple shell execution
  try {
    const env = readEnvFile(path.join(findWorkspaceRoot(process.cwd()) || process.cwd(), '.env'));
    const command = replaceEnvVarsInCommand(test, env);
    
    execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
      timeout: 20000
    });
    
    return {
      name: name,
      passed: true
    };
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string; status?: number };
    const stderrStr = err.stderr ? err.stderr.toString().trim() : '';
    const stdoutStr = err.stdout ? err.stdout.toString().trim() : '';
    return {
      name: name,
      passed: false,
      error: stderrStr || stdoutStr || err.message || 'Command failed'
    };
  }
}

/**
 * Wrapper for checkHttpAccess that handles auth headers
 */
async function checkHttpAccessWrapper(item: CheckItem, _context: string | null = null): Promise<CheckResult> {
  const { name, test } = item;
  
  if (!test) {
    return {
      name: name,
      passed: false,
      error: 'No test specified'
    };
  }
  
  try {
    // Parse "GET https://..." format
    const parts = test.trim().split(/\s+/);
    const method = parts[0] || 'GET';
    const url = parts.slice(1).join(' ');
    
    if (!url) {
      return {
        name: name,
        passed: false,
        error: 'Invalid test format: missing URL'
      };
    }

    // Build headers
    const headers: Record<string, string> = {
      'User-Agent': 'devduck-pre-install-check'
    };

    // Check if check has var property and we need to add auth header
    const env = readEnvFile(path.join(findWorkspaceRoot(process.cwd()) || process.cwd(), '.env'));
    const checkVar = (item as { var?: string }).var;
    if (checkVar) {
      const token = process.env[checkVar] || env[checkVar];
      if (token) {
        // Use Bearer token for non-GitHub APIs
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const httpResult = await makeHttpRequest(method, url, headers);
    
    return {
      name: name,
      passed: httpResult.success,
      statusCode: httpResult.statusCode ?? undefined,
      error: httpResult.success ? undefined : (httpResult.error || (httpResult.statusCode ? `HTTP ${httpResult.statusCode}` : 'Request failed'))
    };
  } catch (error) {
    const err = error as Error;
    return {
      name: name,
      passed: false,
      error: err.message
    };
  }
}

/**
 * Wrapper for replaceVariablesInObject
 */
function replaceVariablesInObjectWrapper(obj: unknown, _env: Record<string, string>): unknown {
  // Simple implementation - just return the object as-is since variables are already replaced
  // in the calling code
  return obj;
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
  // Optimize: Try to reuse already-loaded repos from main install script
  // by checking if the repo path already exists before calling expensive operations
  const externalModules: Module[] = [];
  if (config.repos && Array.isArray(config.repos)) {
    const { loadModulesFromRepo, parseRepoUrl, getDevduckVersion } = await import('../lib/repo-modules.js');
    const devduckVersion = getDevduckVersion();
    
    for (const repoUrl of config.repos) {
      try {
        // Fast path: Check if repo is already loaded in devduck/ directory
        // This avoids expensive resolveRepoPath and loadModulesFromRepo calls
        const parsed = parseRepoUrl(repoUrl);
        let repoName: string;
        if (parsed.type === 'arc') {
          repoName = path.basename(parsed.normalized);
        } else {
          repoName = parsed.normalized
            .replace(/^git@/, '')
            .replace(/\.git$/, '')
            .replace(/[:\/]/g, '_');
        }
        
        const devduckRepoPath = path.join(workspaceRoot, 'devduck', repoName);
        const repoModulesPath = path.join(devduckRepoPath, 'modules');
        
        // If modules directory already exists, skip expensive operations
        if (fs.existsSync(repoModulesPath)) {
          // Repo already loaded, just use it directly
          console.log(`  Loading modules [${repoUrl}]...`);
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
          // Don't print success message - main install script already printed it
        } else {
          // Repo not loaded yet, need to load it properly
          console.log(`  Loading modules [${repoUrl}]...`);
          const loadedModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
          if (fs.existsSync(loadedModulesPath)) {
            const repoModuleEntries = fs.readdirSync(loadedModulesPath, { withFileTypes: true });
            for (const entry of repoModuleEntries) {
              if (entry.isDirectory()) {
                const modulePath = path.join(loadedModulesPath, entry.name);
                const module = loadModuleFromPath(modulePath, entry.name);
                if (module) {
                  externalModules.push(module);
                }
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
        checks: moduleChecks,
        modulePath: module.path
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
        
        // If auth check variable is missing and has install command, try to run it
        if (!check.present && check.install && typeof check.install === 'string') {
          const thingToInstall = check.name || check.description || check.var || 'required component';
          console.log(`  ℹ Installing ${thingToInstall}...`);
          try {
            let installCommand = replaceEnvVarsInCommand(check.install, env);
            // Resolve tsx commands with module-relative paths
            installCommand = resolveTsxCommand(installCommand, moduleResult.modulePath);
            const installOutput = execSync(installCommand, {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
              shell: '/bin/bash',
              timeout: 60000 // Allow more time for compilation
            }).trim();
            
            if (installOutput && !installOutput.includes('not set') && !installOutput.includes('not found')) {
              // Set the variable in env for this check
              env[check.var] = installOutput;
              // Also set in process.env for the test execution
              process.env[check.var] = installOutput;
              
              // Write to .env file to persist the variable
              const envPath = path.join(workspaceRoot, '.env');
              const existingEnv = readEnvFile(envPath);
              existingEnv[check.var] = installOutput;
              writeEnvFile(envPath, existingEnv);
              
              // Mark as present now
              check.present = true;
            }
          } catch (error) {
            const err = error as { message?: string; stderr?: Buffer | string };
            // Don't fail the check if install command fails - it will be reported as missing
            // Just log the error for debugging
            check.error = `Install command failed: ${err.message || 'Command failed'}`;
          }
        }
        
        // If auth check has test field, execute it only if token is present
        if (check.test) {
          if (!check.present) {
            // Don't execute test if token is missing - test will be skipped
            // The missing token will be reported separately, no need to set passed/error
          } else {
            // Execute test check only if token is present using processCheck
            const checkItem: CheckItem = {
              name: check.name || check.var || 'unknown',
              description: check.description,
              test: check.test,
              var: check.var,
              type: check.type
            };
            const checkResult = await processCheck(
              'pre-install',
              moduleResult.name,
              checkItem,
              {
                workspaceRoot: workspaceRoot,
                checkCommand: checkCommandWrapper,
                checkHttpAccess: checkHttpAccessWrapper,
                isHttpRequest: isHttpRequest,
                replaceVariablesInObjectWithLog: replaceVariablesInObjectWrapper
              }
            );
            check.passed = checkResult.passed === true;
            check.error = checkResult.error;
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
              const thingToInstall = testCheckObj.name || testCheckObj.description || testCheckObj.var || 'required component';
              console.log(`  ℹ Installing ${thingToInstall}...`);
              try {
                let installCommand = replaceEnvVarsInCommand(testCheckObj.install, env);
                // Resolve tsx commands with module-relative paths (e.g. "tsx scripts/install-proxy-client.ts")
                installCommand = resolveTsxCommand(installCommand, moduleResult.modulePath);
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
                  
                  // Now execute the test check with the variable set using processCheck
                  const checkItem: CheckItem = {
                    name: testCheckObj.name || 'unknown',
                    description: testCheckObj.description,
                    test: testCheckObj.test,
                    var: testCheckObj.var,
                    type: testCheckObj.type
                  };
                  const checkResult = await processCheck(
                    'pre-install',
                    moduleResult.name,
                    checkItem,
                    {
                      workspaceRoot: workspaceRoot,
                      checkCommand: checkCommandWrapper,
                      checkHttpAccess: checkHttpAccessWrapper,
                      isHttpRequest: isHttpRequest,
                      replaceVariablesInObjectWithLog: replaceVariablesInObjectWrapper
                    }
                  );
                  check.passed = checkResult.passed === true;
                  check.error = checkResult.error;
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
            // Execute test check using processCheck
            const checkItem: CheckItem = {
              name: testCheckObj.name || 'unknown',
              description: testCheckObj.description,
              test: testCheckObj.test,
              var: testCheckObj.var,
              type: testCheckObj.type
            };
            const checkResult = await processCheck(
              'pre-install',
              moduleResult.name,
              checkItem,
              {
                workspaceRoot: workspaceRoot,
                checkCommand: checkCommandWrapper,
                checkHttpAccess: checkHttpAccessWrapper,
                isHttpRequest: isHttpRequest,
                replaceVariablesInObjectWithLog: replaceVariablesInObjectWrapper
              }
            );
            check.passed = checkResult.passed === true;
            check.error = checkResult.error;
          }
        } else {
          // Execute test check even without var (for tests that don't require tokens) using processCheck
          const checkItem: CheckItem = {
            name: testCheckObj.name || 'unknown',
            description: testCheckObj.description,
            test: testCheckObj.test,
            var: testCheckObj.var,
            type: testCheckObj.type
          };
          const checkResult = await processCheck(
            'pre-install',
            moduleResult.name,
            checkItem,
            {
              workspaceRoot: workspaceRoot,
              checkCommand: checkCommandWrapper,
              checkHttpAccess: checkHttpAccessWrapper,
              isHttpRequest: isHttpRequest,
              replaceVariablesInObjectWithLog: replaceVariablesInObjectWrapper
            }
          );
          check.passed = checkResult.passed === true;
          check.error = checkResult.error;
        }
      }
    }
  }
  
  // Get Arcadia root and cache it
  let arcadiaRoot: string | null = null;
  try {
    // First check ARCADIA_ROOT env var
    const envRoot = process.env.ARCADIA_ROOT;
    if (envRoot && fs.existsSync(path.join(envRoot, '.arcadia.root'))) {
      arcadiaRoot = envRoot;
    } else {
      // Execute `arc root` command
      const output = execSync('arc root', { encoding: 'utf8', stdio: 'pipe' });
      const lines = output.trim().split('\n');
      const rootPath = lines[lines.length - 1].trim();
      
      if (rootPath && fs.existsSync(path.join(rootPath, '.arcadia.root'))) {
        arcadiaRoot = rootPath;
      }
    }
  } catch (error) {
    // Command failed or not in Arcadia, arcadiaRoot will remain null
  }
  
  const result: PreInstallCheckResult = {
    ...(arcadiaRoot && { arcadiaRoot }),
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
  
  // Print a detailed per-check breakdown so users can see what exactly was checked.
  // This also makes it obvious when *no* checks were discovered (e.g. module patterns matched nothing).
  type FlatCheck = {
    scopeType: 'project' | 'module';
    scopeName: string;
    check: AuthCheckResult;
  };

  const flatChecks: FlatCheck[] = [];
  for (const project of checkResults.projects) {
    for (const check of project.checks) {
      flatChecks.push({ scopeType: 'project', scopeName: project.name, check });
    }
  }
  for (const module of checkResults.modules) {
    for (const check of module.checks) {
      flatChecks.push({ scopeType: 'module', scopeName: module.name, check });
    }
  }

  const totals = {
    total: flatChecks.length,
    passed: 0,
    failed: 0,
    missingTokens: 0,
    blocked: 0,
    skipped: 0,
    optionalMissing: 0
  };

  const formatScope = (fc: FlatCheck): string => `${fc.scopeType}: ${fc.scopeName}`;
  const formatCheckLabel = (c: AuthCheckResult): string => {
    if (c.type === 'auth') return c.var ? `auth ${c.var}` : 'auth';
    return c.name ? `test ${c.name}` : c.test ? `test ${c.test}` : 'test';
  };

  const classify = (c: AuthCheckResult): { icon: string; color: 'green' | 'red' | 'yellow' | 'cyan'; bucket: keyof typeof totals } => {
    if (c.type === 'auth') {
      if (c.present) return { icon: symbols.success, color: 'green', bucket: 'passed' };
      if (c.optional === true) return { icon: symbols.info, color: 'cyan', bucket: 'optionalMissing' };
      return { icon: symbols.info, color: 'yellow', bucket: 'missingTokens' };
    }

    // type === 'test'
    if (c.passed === true) return { icon: symbols.success, color: 'green', bucket: 'passed' };
    if (c.passed === false) {
      if (isRequiredTokenMissingError(c.error)) return { icon: symbols.info, color: 'yellow', bucket: 'blocked' };
      return { icon: symbols.error, color: 'red', bucket: 'failed' };
    }

    // no explicit result -> treat as skipped
    return { icon: symbols.info, color: 'cyan', bucket: 'skipped' };
  };

  for (const fc of flatChecks) {
    const { icon, color, bucket } = classify(fc.check);
    totals[bucket] += 1;
    const desc = fc.check.description ? ` - ${fc.check.description}` : '';
    const err = fc.check.error ? ` - ${fc.check.error}` : '';
    const optional = fc.check.optional === true ? ' (optional)' : '';
    print(`  ${icon} [${formatScope(fc)}] ${formatCheckLabel(fc.check)}${optional}${desc}${err}`, color);
  }

  const projectChecksCount = checkResults.projects.reduce((acc, p) => acc + p.checks.length, 0);
  const moduleChecksCount = checkResults.modules.reduce((acc, m) => acc + m.checks.length, 0);

  const requiredTotal = totals.total - totals.optionalMissing;
  const requiredPassed = totals.passed;

  print(
    `  ${symbols.info} Pre-install checks summary: required ${requiredPassed}/${requiredTotal} passed (optional missing: ${totals.optionalMissing}; projects: ${projectChecksCount}, modules: ${moduleChecksCount}; missing tokens: ${totals.missingTokens}, failed: ${totals.failed}, blocked: ${totals.blocked}, skipped: ${totals.skipped})`,
    'cyan'
  );
  
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
  const tokenBlockedTests: Array<{ name: string; error?: string; description?: string; docs?: string }> = [];
  const realFailedTests: Array<{ name: string; error?: string; description?: string; docs?: string }> = [];
  
  for (const module of checkResults.modules) {
    for (const check of module.checks) {
      // Check standalone test checks
      if (check.type === 'test' && check.passed === false && check.optional !== true) {
        hasFailedTests = true;
        const checkName = check.name || check.test || 'unknown';
        const entry = { 
          name: `${checkName} (module: ${module.name})`, 
          error: check.error,
          description: check.description,
          docs: check.docs
        };
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
        realFailedTests.push({ 
          name: `${checkName} (module: ${module.name})`, 
          error: check.error,
          description: check.description,
          docs: check.docs
        });
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
        const desc = test.description ? ` - ${test.description}` : '';
        const docs = test.docs ? `\n      ${test.docs}` : '';
        if (test.error) {
          print(`    - ${test.name}${desc} - ${test.error}${docs}`, 'red');
        } else {
          print(`    - ${test.name}${desc}${docs}`, 'red');
        }
      }
      if (tokenBlockedTests.length > 0) {
        print(`  Token-dependent checks blocked:`, 'yellow');
        for (const test of tokenBlockedTests) {
          const desc = test.description ? ` - ${test.description}` : '';
          const docs = test.docs ? `\n      ${test.docs}` : '';
          if (test.error) {
            print(`    - ${test.name}${desc} - ${test.error}${docs}`, 'yellow');
          } else {
            print(`    - ${test.name}${desc}${docs}`, 'yellow');
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
  
  // Important nuance: optional checks can be missing while all REQUIRED checks pass.
  // Do not print a confusing totals ratio like "1/2" and call it "all passed".
  print(
    `  ${symbols.success} All required pre-install checks passed (${requiredPassed}/${requiredTotal}). Optional missing: ${totals.optionalMissing}`,
    'green'
  );
  log(`Pre-install checks passed`);
  return 'ok';
}


