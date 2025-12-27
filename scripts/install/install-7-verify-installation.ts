#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { print, symbols } from '../utils.js';
import { readJSON } from '../lib/config.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import { createCheckFunctions, makeCheckId, trackCheckExecution, loadModulesForChecks, loadProjectsForChecks } from './install-common.js';
import { processCheck } from './process-check.js';

export interface VerifyInstallationResult {
  checks: Array<{ checkId: string; result: CheckResult }>;
  mcpServers?: unknown[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const TIER_ORDER = ['pre-install', 'install', 'live', 'pre-test', 'tests'];
const DEFAULT_TIER = 'pre-install';

export async function installStep7VerifyInstallation(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; result: VerifyInstallationResult }> {
  const { workspaceRoot, config, log } = params;

  print(`\n[Step 7] Verify installation...`, 'cyan');
  log(`[step-7] Verify installation`);

  const { checkCommand, checkHttpAccess, isHttpRequest, replaceVariablesInObjectWithLog } = createCheckFunctions(workspaceRoot, log, {
    autoYes: true, // verification should not prompt
    projectsDir: path.join(workspaceRoot, 'projects'),
    projectRoot: PROJECT_ROOT
  });

  const loadedModules = await loadModulesForChecks(workspaceRoot, config, {
    includeRepos: true,
    includeProjectsModules: true
  });
  const loadedProjects = loadProjectsForChecks(workspaceRoot, config);

  // Collect checks from:
  // - workspace config checks
  // - modules checks
  // - projects checks
  const allChecksByTier: Record<string, Array<{ contextType: string; contextName: string | null; item: CheckItem }>> = {};

  const push = (tier: string, ctxType: string, ctxName: string | null, item: CheckItem) => {
    if (!allChecksByTier[tier]) allChecksByTier[tier] = [];
    allChecksByTier[tier].push({ contextType: ctxType, contextName: ctxName, item });
  };

  // workspace checks
  for (const raw of (Array.isArray(config.checks) ? (config.checks as any[]) : [])) {
    const item: CheckItem = raw as any;
    const tier = (item as any).tier || DEFAULT_TIER;
    push(tier, 'workspace', null, item);
  }

  // module checks
  for (const m of loadedModules) {
    const moduleName = m.name;
    const checks = Array.isArray(m.checks) ? (m.checks as any[]) : [];
    for (const raw of checks) {
      const c = raw as any;
      const item: CheckItem = { ...c, module: moduleName, name: c.name || `${moduleName}-${c.type || 'check'}` };
      const tier = (item as any).tier || DEFAULT_TIER;
      push(tier, 'module', moduleName, item);
    }
  }

  // project checks (from config)
  for (const p of loadedProjects) {
    const projectName = p.name;
    const checks = Array.isArray(p.checks) ? (p.checks as any[]) : [];
    for (const raw of checks) {
      const item: CheckItem = raw as any;
      const tier = (item as any).tier || DEFAULT_TIER;
      push(tier, 'project', projectName, item);
    }
  }

  const results: Array<{ checkId: string; result: CheckResult }> = [];
  let requiredFailedCount = 0;
  let optionalFailedCount = 0;

  for (const tier of TIER_ORDER) {
    const tierChecks = allChecksByTier[tier];
    if (!tierChecks || tierChecks.length === 0) continue;
    print(`\n  ${symbols.info} [${tier}] Verifying checks...`, 'cyan');
    for (const { contextType, contextName, item } of tierChecks) {
      const checkId = makeCheckId(contextType, contextName, item.name);
      const res = await processCheck(contextType, contextName, item, {
        tier,
        workspaceRoot,
        skipInstall: true,
        checkCommand,
        checkHttpAccess,
        isHttpRequest,
        replaceVariablesInObjectWithLog
      });
      results.push({ checkId, result: res });
      trackCheckExecution(checkId, 'verify-installation', res, workspaceRoot);

      const isOptional = (item as any).optional === true;
      if (res.passed === false) {
        if (isOptional) optionalFailedCount++;
        else requiredFailedCount++;
      }
    }
  }

  // MCP server verification (if mcp.json exists)
  let mcpServers: unknown[] | undefined;
  try {
    const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
    const mcpJson = readJSON(mcpJsonPath) as { mcpServers?: Record<string, unknown> } | null;
    if (mcpJson && mcpJson.mcpServers) {
      const { checkMcpServers } = await import('./mcp.js');
      mcpServers = await checkMcpServers(mcpJson.mcpServers, workspaceRoot, { log, print, symbols });
    }
  } catch (e) {
    const err = e as Error;
    print(`  ${symbols.warning} MCP verification skipped: ${err.message}`, 'yellow');
  }

  if (optionalFailedCount > 0) {
    print(`\n${symbols.warning} Step 7 warning: ${optionalFailedCount} optional check(s) did not verify`, 'yellow');
  }
  if (requiredFailedCount > 0) {
    print(`\n${symbols.error} Step 7 failed: ${requiredFailedCount} required check(s) did not verify`, 'red');
    return { ok: false, result: { checks: results, mcpServers } };
  }

  print(`\n${symbols.success} Step 7 completed`, 'green');
  return { ok: true, result: { checks: results, mcpServers } };
}

