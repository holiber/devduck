#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

import { readEnvFile } from '../lib/env.js';
import { replaceVariablesInObject } from '../lib/config.js';
import { print as printUtil, symbols as symbolsUtil, executeCommand, executeInteractiveCommand, requiresSudo, createReadlineInterface, promptUser } from '../utils.js';

import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import type { CheckCommandFunction, CheckHttpAccessFunction, IsHttpRequestFunction, ReplaceVariablesFunction } from './check-functions.js';

import type { EnvRequirement } from './install-state.js';
import { getExecutedChecks, readInstallState, trackExecutedCheck, type InstallStepKey } from './install-state.js';

// Use imported utils with fallback (some tests may stub imports)
const print = printUtil || ((msg: string) => console.log(msg));
const symbols = symbolsUtil || { success: '✓', error: '✗', warning: '⚠', info: 'ℹ', search: '🔍', check: '✅', file: '📝', log: '📋' };

export interface EnvRequirementMapEntry {
  name: string;
  description?: string;
  optional?: boolean;
  source: string;
}

export type EnvRequirementsMap = Map<string, EnvRequirementMapEntry>;

export interface EnvCheckSummary {
  present: string[];
  missing: string[];
  optionalMissing: string[];
  requirements: EnvRequirement[];
}

export function makeCheckId(contextType: string, contextName: string | null, checkName: string): string {
  return `${contextType}:${contextName || 'workspace'}:${checkName}`;
}

export function getProjectNameFromSrc(src: string | undefined): string {
  if (!src) return 'unknown';
  if (src.startsWith('arc://')) return path.basename(src.replace(/^arc:\/\//, ''));
  if (src.includes('github.com/')) {
    const match = src.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match) return match[1].replace(/\.git$/, '');
  }
  return path.basename(src);
}

export function collectAllEnvRequirements(
  workspaceRoot: string,
  config: WorkspaceConfig,
  loadedModules: Array<{ name: string; checks?: Array<Record<string, unknown>> }> = [],
  loadedProjects: Array<{ name: string; checks?: CheckItem[] }> = [],
  options: { includeChecksWithInstall?: boolean } = {}
): EnvRequirementsMap {
  const includeChecksWithInstall = options.includeChecksWithInstall !== false;
  const reqs: EnvRequirementsMap = new Map();

  const add = (name: string, entry: Omit<EnvRequirementMapEntry, 'name'>) => {
    const varName = name.trim();
    if (!varName) return;
    // Merge sources/descriptions best-effort (keep first description, make source additive).
    const existing = reqs.get(varName);
    if (!existing) {
      reqs.set(varName, { name: varName, ...entry });
      return;
    }
    const mergedSource = existing.source.includes(entry.source) ? existing.source : `${existing.source}; ${entry.source}`;
    reqs.set(varName, {
      ...existing,
      source: mergedSource,
      description: existing.description || entry.description,
      optional: existing.optional || entry.optional
    });
  };

  // workspace.config.json: env[]
  if (Array.isArray(config.env)) {
    for (const e of config.env) {
      const name = e && typeof e === 'object' ? (e as { name?: string }).name : undefined;
      if (!name) continue;
      add(name, {
        source: 'workspace.config.json env[]',
        description: (e as { description?: string }).description,
        optional: false
      });
    }
  }

  const collectFromChecks = (checks: unknown[], sourceLabel: string) => {
    for (const raw of checks) {
      if (!raw || typeof raw !== 'object') continue;
      const check = raw as Record<string, unknown>;
      const varName = typeof check.var === 'string' ? check.var : undefined;
      if (!varName) continue;
      const install = typeof check.install === 'string' ? check.install.trim() : '';
      if (!includeChecksWithInstall && install) continue;
      add(varName, {
        source: sourceLabel,
        description: typeof check.description === 'string' ? check.description : undefined,
        optional: check.optional === true
      });
    }
  };

  // workspace checks
  if (Array.isArray(config.checks)) {
    collectFromChecks(config.checks as unknown[], 'workspace.config.json checks[]');
  }

  // module checks
  for (const m of loadedModules) {
    if (m && Array.isArray(m.checks)) {
      collectFromChecks(m.checks as unknown[], `module:${m.name}`);
    }
  }

  // project checks (from config)
  for (const p of loadedProjects) {
    if (p && Array.isArray(p.checks)) {
      collectFromChecks(p.checks as unknown[], `project:${p.name}`);
    }
  }

  return reqs;
}

export function checkEnvVariables(envRequirements: EnvRequirementsMap, envFilePath: string): EnvCheckSummary {
  const envFile = readEnvFile(envFilePath);
  const present: string[] = [];
  const missing: string[] = [];
  const optionalMissing: string[] = [];

  const requirements: EnvRequirement[] = [];

  for (const [name, req] of envRequirements.entries()) {
    requirements.push({
      name,
      description: req.description,
      optional: !!req.optional,
      source: req.source
    });

    const value = process.env[name] || envFile[name];
    const hasValue = value !== undefined && String(value).trim() !== '';
    if (hasValue) {
      present.push(name);
    } else if (req.optional) {
      optionalMissing.push(name);
    } else {
      missing.push(name);
    }
  }

  // Stable ordering for consistent output / tests
  present.sort();
  missing.sort();
  optionalMissing.sort();

  // Print summary
  for (const name of present) {
    print(`  ${symbols.success} ${name} - present`, 'green');
  }
  for (const name of missing) {
    const r = envRequirements.get(name);
    print(`  ${symbols.error} ${name} - missing${r?.description ? ` (${r.description})` : ''}`, 'red');
  }
  for (const name of optionalMissing) {
    const r = envRequirements.get(name);
    print(`  ${symbols.warning} ${name} - missing (optional)${r?.description ? ` (${r.description})` : ''}`, 'yellow');
  }

  return { present, missing, optionalMissing, requirements };
}

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
        const statusCode = res.statusCode ?? null;
        // Treat 2xx and 429 as success (rate limited but token likely valid).
        const ok = statusCode !== null && ((statusCode >= 200 && statusCode < 300) || statusCode === 429);
        resolve({ success: ok, statusCode, error: null, body: data });
      });
    });

    req.on('error', (error) => resolve({ success: false, statusCode: null, error: error.message, body: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, statusCode: null, error: 'Request timeout', body: null, timeout: true });
    });
    req.end();
  });
}

function isFilePath(check: string | undefined): boolean {
  if (!check) return false;
  const trimmed = check.trim();
  if (!trimmed) return false;
  if (trimmed.includes(' ')) return false;
  if (trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes(';') || trimmed.includes('|')) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return true;
  if (trimmed.includes('/') && !trimmed.includes(' ')) return true;
  return false;
}

function checkFileExists(filePath: string): { exists: boolean; isFile: boolean; isDirectory: boolean; path: string } {
  // Expand ~ to home directory
  const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
  const resolvedPath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(expandedPath);
  try {
    if (!fs.existsSync(resolvedPath)) {
      return { exists: false, isFile: false, isDirectory: false, path: resolvedPath };
    }
    const stats = fs.statSync(resolvedPath);
    return { exists: true, isFile: stats.isFile(), isDirectory: stats.isDirectory(), path: resolvedPath };
  } catch {
    return { exists: false, isFile: false, isDirectory: false, path: resolvedPath };
  }
}

async function installSoftware(item: CheckItem, options: { autoYes: boolean; log: (s: string) => void }): Promise<boolean> {
  const { name, install } = item;
  if (!install) return false;

  print(`  ${symbols.info} Installation command found for ${name}`, 'cyan');
  options.log(`Installation command: ${install}`);

  let answer = 'y';
  if (!options.autoYes) {
    const rl = createReadlineInterface();
    answer = await promptUser(rl, `  Do you want to install ${name}? (y/n) [y]: `);
    rl.close();
  } else {
    print(`  ${symbols.info} Non-interactive mode: auto-installing ${name}`, 'cyan');
    options.log(`Non-interactive mode: auto-installing ${name}`);
  }

  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    print(`  ${symbols.warning} Installation skipped by user`, 'yellow');
    options.log(`Installation skipped by user`);
    return false;
  }

  print(`  Installing ${name}...`, 'cyan');
  options.log(`Executing installation command: ${install}`);
  try {
    const isSudo = requiresSudo(install);
    const result = isSudo
      ? executeInteractiveCommand(install)
      : executeCommand(install, { shell: '/bin/bash', cwd: (item as { _execCwd?: string })._execCwd });
    if (result.success) {
      print(`  ${symbols.success} Installation command completed`, 'green');
      options.log(`  Installation SUCCESS`);
      return true;
    }
    print(`  ${symbols.error} Installation failed: ${result.error || 'Command failed'}`, 'red');
    options.log(`  Installation FAILED - Error: ${result.error || 'Command failed'}`);
    return false;
  } catch (e) {
    const err = e as Error;
    print(`  ${symbols.error} Installation error: ${err.message}`, 'red');
    options.log(`  Installation ERROR - ${err.message}`);
    return false;
  }
}

export function createCheckFunctions(
  workspaceRoot: string,
  log: (message: string) => void,
  options: { autoYes?: boolean; projectsDir?: string; projectRoot?: string } = {}
): {
  checkCommand: CheckCommandFunction;
  checkHttpAccess: CheckHttpAccessFunction;
  isHttpRequest: IsHttpRequestFunction;
  replaceVariablesInObjectWithLog: ReplaceVariablesFunction;
} {
  const autoYes = options.autoYes ?? false;
  const projectsDir = options.projectsDir || path.join(workspaceRoot, 'projects');
  const projectRoot = options.projectRoot || workspaceRoot;
  const envFilePath = path.join(workspaceRoot, '.env');

  const replaceVariablesInObjectWithLog: ReplaceVariablesFunction = (obj: unknown, env: Record<string, string>) => {
    return replaceVariablesInObject(obj, env);
  };

  const isHttpRequest: IsHttpRequestFunction = (test: string | undefined): boolean => {
    if (!test) return false;
    return /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+https?:\/\//i.test(test.trim());
  };

  const checkHttpAccess: CheckHttpAccessFunction = async (item: CheckItem, context: string | null): Promise<CheckResult> => {
    const { name, description, test } = item;
    const contextSuffix = context ? ` [${context}]` : '';
    print(`Checking ${name}${contextSuffix}...`, 'cyan');
    log(`Checking HTTP access: ${name} (${description || ''})`);

    if (!test || typeof test !== 'string') {
      return { name, passed: false, error: 'No test specified' };
    }
    try {
      const parts = test.trim().split(/\s+/);
      const method = parts[0] || 'GET';
      const url = parts.slice(1).join(' ');
      const result = await makeHttpRequest(method, url);
      if (result.success) {
        print(`${symbols.success} ${name} - OK`, 'green');
        return { name, passed: true, statusCode: result.statusCode };
      }
      print(`${symbols.error} ${name} - Failed (${result.statusCode || result.error})`, 'red');
      if (description) print(description, 'red');
      const docs = (item as { docs?: string }).docs;
      if (docs) print(docs, 'red');
      return { name, passed: false, error: result.error || `HTTP ${result.statusCode}` };
    } catch (e) {
      const err = e as Error;
      print(`${symbols.error} ${name} - Error: ${err.message}`, 'red');
      if (description) print(description, 'red');
      return { name, passed: false, error: err.message };
    }
  };

  const checkCommand: CheckCommandFunction = async (item: CheckItem, context: string | null, skipInstall = false): Promise<CheckResult> => {
    const { name, description, test, install } = item;
    const contextSuffix = context ? ` [${context}]` : '';

    print(`Checking ${name}${contextSuffix}...`, 'cyan');
    log(`Checking command: ${name} (${description || ''})`);

    const env = readEnvFile(envFilePath);

    // Default test for MCP checks: if no explicit test provided, verify MCP via tools/list.
    let effectiveTest = test;
    if ((!effectiveTest || typeof effectiveTest !== 'string' || !effectiveTest.trim()) && item.mcpSettings && name) {
      effectiveTest = `node "${path.join(projectRoot, 'scripts', 'test-mcp.js')}" "${name}"`;
    }

    if (!effectiveTest) {
      print(`${symbols.warning} ${name} - No test command specified`, 'yellow');
      if (description) print(description, 'yellow');
      return { name, passed: false, version: null, note: 'No test command specified' };
    }

    const replaceVarsInString = (s: string) => s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, varName) => {
      const v = process.env[varName] || env[varName];
      return v !== undefined ? String(v) : m;
    });

    const testWithVars = replaceVarsInString(effectiveTest);
    const installWithVars = install ? replaceVarsInString(install) : install;

    // File/directory check
    if (isFilePath(testWithVars)) {
      const fileCheck = checkFileExists(testWithVars);
      if (fileCheck.exists && (fileCheck.isFile || fileCheck.isDirectory)) {
        const typeLabel = fileCheck.isDirectory ? 'directory exists' : 'file exists';
        print(`${symbols.success} ${name} - OK`, 'green');
        return { name, passed: true, version: typeLabel, filePath: fileCheck.path };
      }

      print(`${symbols.error} ${name} - Path not found: ${testWithVars}`, 'red');
      if (description) print(description, 'red');
      if (installWithVars && !skipInstall) {
        const installed = await installSoftware({ ...item, install: installWithVars }, { autoYes, log });
        if (installed) {
          print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
          const recheck = checkFileExists(testWithVars);
          if (recheck.exists && (recheck.isFile || recheck.isDirectory)) {
            const typeLabel = recheck.isDirectory ? 'directory exists' : 'file exists';
            print(`${symbols.success} ${name} - OK`, 'green');
            return { name, passed: true, version: typeLabel, filePath: recheck.path, note: 'Installed during setup' };
          }
          print(`${symbols.warning} ${name} - Installation completed but path not found`, 'yellow');
          return { name, passed: false, version: null, note: 'Installation attempted but path not found' };
        }
      }
      return { name, passed: false, version: null, filePath: fileCheck.path };
    }

    // Command execution
    let command = testWithVars;
    if (name === 'nvm') {
      command = `source ~/.nvm/nvm.sh && ${testWithVars}`;
    }

    // Handle API calls (commands starting with "api ")
    let apiCommandHandled = false;
    if (command.trim().startsWith('api ')) {
      const apiCommand = command.trim().substring(4);
      command = `npm run call -- ${apiCommand}`;
      apiCommandHandled = true;
    }

    const execOptions: { cwd?: string } = {};
    if (apiCommandHandled) {
      execOptions.cwd = workspaceRoot;
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

    const isSudo = requiresSudo(command);
    const result = isSudo ? executeInteractiveCommand(command) : executeCommand(command, execOptions);

    let commandSuccess = result.success;
    if (apiCommandHandled && result.success) {
      const resultValue = result.output?.trim().split('\n').pop()?.trim() || '';
      commandSuccess = resultValue === 'true';
    }

    if (commandSuccess) {
      const isTestCheck = (item as { type?: string }).type === 'test' || ((item as { type?: string }).type === 'auth' && !!item.test);
      const version = isSudo ? 'passed' : (result.output || (isTestCheck ? 'OK' : 'unknown'));
      print(`${symbols.success} ${name} - ${version}`, 'green');
      return { name, passed: true, version };
    }

    const itemVar = (item as { var?: string }).var;
    const isAuth = (item as { type?: string }).type === 'auth' && !!itemVar;
    const errorLabel = isAuth ? `${itemVar} check failed` : 'Not installed';
    print(`${symbols.error} ${name} - ${errorLabel}`, 'red');
    if (description) print(description, 'red');
    const docs = (item as { docs?: string }).docs;
    if (docs) print(docs, 'red');

    if (install && !skipInstall) {
      const installed = await installSoftware({ ...item, _execCwd: execOptions.cwd }, { autoYes, log });
      if (installed) {
        print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
        const retry = isSudo ? executeInteractiveCommand(command) : executeCommand(command, execOptions);
        if (retry.success) {
          const isTestCheck = (item as { type?: string }).type === 'test' || ((item as { type?: string }).type === 'auth' && !!item.test);
          const version = isSudo ? 'passed' : (retry.output || (isTestCheck ? 'OK' : 'unknown'));
          print(`${symbols.success} ${name} - ${version}`, 'green');
          return { name, passed: true, version, note: 'Installed during setup' };
        }
        const retryLabel = isAuth ? `${itemVar} check failed` : 'Installation completed but verification failed';
        print(`${symbols.warning} ${name} - ${retryLabel}`, 'yellow');
        return { name, passed: false, version: null, note: retryLabel };
      }
    }

    return { name, passed: false, version: null, note: isAuth ? `${itemVar} check failed` : undefined, error: result.error || undefined };
  };

  return { checkCommand, checkHttpAccess, isHttpRequest, replaceVariablesInObjectWithLog };
}

export function trackCheckExecution(checkId: string, step: InstallStepKey, result: CheckResult, workspaceRoot: string): void {
  trackExecutedCheck(workspaceRoot, { checkId, step, passed: result.passed });
}

export function getAlreadyExecutedCheckIds(workspaceRoot: string): Set<string> {
  return getExecutedChecks(readInstallState(workspaceRoot));
}

export async function loadModulesForChecks(
  workspaceRoot: string,
  config: WorkspaceConfig,
  options: { includeRepos?: boolean; includeProjectsModules?: boolean } = {}
): Promise<Array<{ name: string; path: string; checks?: Array<Record<string, unknown>> }>> {
  const includeRepos = options.includeRepos !== false;
  const includeProjectsModules = options.includeProjectsModules !== false;

  const moduleResolver = await import('./module-resolver.js');
  const { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies, loadModuleFromPath } = moduleResolver;
  type Module = Awaited<ReturnType<typeof getAllModules>>[number];

  const builtInModules: Module[] = getAllModules();
  const workspaceModulesDir = path.join(workspaceRoot, 'modules');
  const workspaceModules: Module[] = getAllModulesFromDirectory(workspaceModulesDir);

  const externalModules: Module[] = [];
  if (includeRepos && Array.isArray(config.repos) && config.repos.length > 0) {
    const { loadModulesFromRepo, getDevduckVersion } = await import('../lib/repo-modules.js');
    const devduckVersion = getDevduckVersion();
    for (const repoUrl of config.repos) {
      try {
        const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
        if (fs.existsSync(repoModulesPath)) {
          const entries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const modulePath = path.join(repoModulesPath, entry.name);
            const mod = loadModuleFromPath(modulePath, entry.name);
            if (mod) externalModules.push(mod);
          }
        }
      } catch {
        // ignore, repo may not be downloaded yet
      }
    }
  }

  const projectModules: Module[] = [];
  if (includeProjectsModules && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      const projectName = getProjectNameFromSrc(project.src);
      const projectPath = path.join(workspaceRoot, 'projects', projectName);
      const projectModulesDir = path.join(projectPath, 'modules');
      if (fs.existsSync(projectModulesDir)) {
        projectModules.push(...getAllModulesFromDirectory(projectModulesDir));
      }
    }
  }

  // Priority: workspace > projects > external repos > built-in
  const allModules: Module[] = [...workspaceModules, ...projectModules, ...externalModules, ...builtInModules];
  const moduleNames = expandModuleNames((config.modules || ['*']) as string[], allModules);
  const resolved = resolveDependencies(moduleNames, allModules);

  return resolved.map((m: any) => ({ name: m.name, path: m.path, checks: m.checks || [] }));
}

export function loadProjectsForChecks(
  _workspaceRoot: string,
  config: WorkspaceConfig
): Array<{ name: string; src?: string; checks?: CheckItem[] }> {
  const projects = Array.isArray(config.projects) ? config.projects : [];
  return projects.map((p) => ({
    name: getProjectNameFromSrc(p.src),
    src: p.src,
    checks: Array.isArray(p.checks) ? (p.checks as CheckItem[]) : []
  }));
}

