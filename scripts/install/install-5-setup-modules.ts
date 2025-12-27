#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { print, symbols } from '../utils.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import { createCheckFunctions, makeCheckId, trackCheckExecution, getAlreadyExecutedCheckIds } from './install-common.js';
import { processCheck } from './process-check.js';

export interface SetupModulesResult {
  installedModules: Record<string, string>;
  hookResults: Array<{ module: string; hook: string; success: boolean; skipped?: boolean; errors?: string[] }>;
  checks: CheckResult[];
}

const TIER_ORDER = ['pre-install', 'install', 'live', 'pre-test', 'tests'];
const DEFAULT_TIER = 'pre-install';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export async function installStep5SetupModules(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  autoYes: boolean;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; result: SetupModulesResult }> {
  const { workspaceRoot, config, autoYes, log } = params;

  print(`\n[Step 5] Setup modules...`, 'cyan');
  log(`[step-5] Setup modules`);

  const cacheDevduckDir = path.join(workspaceRoot, '.cache', 'devduck');
  if (!fs.existsSync(cacheDevduckDir)) fs.mkdirSync(cacheDevduckDir, { recursive: true });

  // Resolve/load modules with explicit priority:
  // 1) workspace modules, 2) project modules, 3) external repos, 4) built-in devduck modules.
  const moduleResolver = await import('./module-resolver.js');
  const { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies, mergeModuleSettings, loadModuleFromPath } = moduleResolver;
  type Module = Awaited<ReturnType<typeof getAllModules>>[number];

  const builtInModules: Module[] = getAllModules();
  const workspaceModules: Module[] = getAllModulesFromDirectory(path.join(workspaceRoot, 'modules'));

  const projectModules: Module[] = [];
  if (Array.isArray(config.projects)) {
    for (const project of config.projects) {
      const projectName = project.src?.split('/').pop()?.replace(/\.git$/, '') || '';
      const projectPath = path.join(workspaceRoot, 'projects', projectName);
      const projectModulesDir = path.join(projectPath, 'modules');
      if (fs.existsSync(projectModulesDir)) {
        projectModules.push(...getAllModulesFromDirectory(projectModulesDir));
      }
    }
  }

  const externalModules: Module[] = [];
  if (Array.isArray(config.repos) && config.repos.length > 0) {
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
      } catch (e) {
        const err = e as Error;
        print(`  ${symbols.warning} Failed to load repo modules for setup: ${repoUrl} (${err.message})`, 'yellow');
        log(`[step-5] Failed to load repo modules for setup: ${repoUrl} (${err.message})`);
      }
    }
  }

  const allModules: Module[] = [...workspaceModules, ...projectModules, ...externalModules, ...builtInModules];
  const moduleNames = expandModuleNames((config.modules || ['*']) as string[], allModules);
  const resolvedModules = resolveDependencies(moduleNames, allModules);

  const { loadModuleResources } = await import('./module-loader.js');
  const loadedModules = resolvedModules.map((m: any) => {
    const resources = loadModuleResources(m);
    const mergedSettings = mergeModuleSettings(m, config.moduleSettings);
    return { ...resources, settings: mergedSettings };
  });

  const installedModules: Record<string, string> = {};
  for (const m of loadedModules) {
    if (m && typeof m.name === 'string' && typeof m.path === 'string') installedModules[m.name] = m.path;
  }

  // Execute hooks: pre-install -> install -> post-install
  const { executeHooksForStage, createHookContext } = await import('./module-hooks.js');
  const hookResults: Array<{ module: string; hook: string; success: boolean; skipped?: boolean; errors?: string[] }> = [];

  for (const hookName of ['pre-install', 'install', 'post-install']) {
    print(`  ${symbols.info} Running module hooks: ${hookName}`, 'cyan');
    const contexts = loadedModules.map((m) => createHookContext(workspaceRoot, m, loadedModules));
    const results = await executeHooksForStage(loadedModules, hookName, contexts);
    for (const r of results) {
      hookResults.push({ module: r.module, hook: r.hook, success: r.success, skipped: r.skipped, errors: r.errors });
      if (!r.success) {
        print(`  ${symbols.error} ${r.module}: hook "${hookName}" failed`, 'red');
        if (r.errors && r.errors.length > 0) print(`    ${r.errors.join('; ')}`, 'red');
      }
    }
  }

  const hookFailed = hookResults.some((r) => r.success === false);
  if (hookFailed) {
    print(`\n${symbols.error} Step 5 failed: one or more module hooks failed`, 'red');
    return { ok: false, result: { installedModules, hookResults, checks: [] } };
  }

  // Generate MCP config after modules are available (modules may provide mcpSettings).
  try {
    const { generateMcpJson } = await import('./mcp.js');
    const moduleChecksForMcp = loadedModules.flatMap((m: any) => (Array.isArray(m.checks) ? m.checks : []));
    generateMcpJson(workspaceRoot, { log, print, symbols, moduleChecks: moduleChecksForMcp });
  } catch (e) {
    const err = e as Error;
    print(`  ${symbols.warning} Failed to generate mcp.json: ${err.message}`, 'yellow');
    log(`[step-5] Failed to generate mcp.json: ${err.message}`);
  }

  // Run module checks (skip auth/env checks here; they are validated in steps 1/4 and tested in step 7).
  const executed = getAlreadyExecutedCheckIds(workspaceRoot);
  const { checkCommand, checkHttpAccess, isHttpRequest, replaceVariablesInObjectWithLog } = createCheckFunctions(workspaceRoot, log, {
    autoYes,
    projectsDir: path.join(workspaceRoot, 'projects'),
    projectRoot: PROJECT_ROOT
  });

  const checks: CheckResult[] = [];
  let requiredFailedCount = 0;
  let optionalFailedCount = 0;

  // Group module checks by tier
  const checksByTier: Record<string, Array<{ moduleName: string; item: CheckItem }>> = {};
  for (const module of loadedModules) {
    const moduleName = module.name;
    const moduleChecks = Array.isArray(module.checks) ? module.checks : [];
    for (const raw of moduleChecks) {
      const c = raw as any;
      const item: CheckItem = { ...c, module: moduleName, name: c.name || `${moduleName}-${c.type || 'check'}` };
      // Skip auth checks without install commands: env presence is handled in steps 1/4, testing in step 7.
      if ((item as any).type === 'auth' && !(typeof item.install === 'string' && item.install.trim())) continue;
      const tier = (item as any).tier || DEFAULT_TIER;
      if (!checksByTier[tier]) checksByTier[tier] = [];
      checksByTier[tier].push({ moduleName, item });
    }
  }

  for (const tier of TIER_ORDER) {
    const tierChecks = checksByTier[tier];
    if (!tierChecks || tierChecks.length === 0) continue;
    print(`\n  ${symbols.info} [${tier}] Running module checks...`, 'cyan');
    for (const { moduleName, item } of tierChecks) {
      const checkId = makeCheckId('module', moduleName, item.name);
      if (executed.has(checkId)) continue;
      const res = await processCheck('module', moduleName, item, {
        tier,
        workspaceRoot,
        checkCommand,
        checkHttpAccess,
        isHttpRequest,
        replaceVariablesInObjectWithLog
      });
      checks.push(res);
      trackCheckExecution(checkId, 'setup-modules', res, workspaceRoot);

      const isOptional = (item as any).optional === true;
      if (res.passed === false) {
        if (isOptional) optionalFailedCount++;
        else requiredFailedCount++;
      }
    }
  }

  if (optionalFailedCount > 0) {
    print(`\n${symbols.warning} Step 5 warning: ${optionalFailedCount} optional module check(s) failed`, 'yellow');
  }
  if (requiredFailedCount > 0) {
    print(`\n${symbols.warning} Step 5 warning: ${requiredFailedCount} required module check(s) failed`, 'yellow');
    return { ok: false, result: { installedModules, hookResults, checks } };
  }

  print(`\n${symbols.success} Step 5 completed`, 'green');
  return { ok: true, result: { installedModules, hookResults, checks } };
}

