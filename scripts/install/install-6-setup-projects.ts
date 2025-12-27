#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { print, symbols } from '../utils.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import { createCheckFunctions, makeCheckId, trackCheckExecution, getAlreadyExecutedCheckIds, getProjectNameFromSrc } from './install-common.js';
import { processCheck } from './process-check.js';

export interface SetupProjectsResult {
  checks: Array<{ project: string; result: CheckResult }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const TIER_ORDER = ['pre-install', 'install', 'live', 'pre-test', 'tests'];
const DEFAULT_TIER = 'pre-install';

export async function installStep6SetupProjects(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  autoYes: boolean;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; result: SetupProjectsResult }> {
  const { workspaceRoot, config, autoYes, log } = params;

  print(`\n[Step 6] Setup projects...`, 'cyan');
  log(`[step-6] Setup projects`);

  const projects = Array.isArray(config.projects) ? config.projects : [];
  const executed = getAlreadyExecutedCheckIds(workspaceRoot);
  const { checkCommand, checkHttpAccess, isHttpRequest, replaceVariablesInObjectWithLog } = createCheckFunctions(workspaceRoot, log, {
    autoYes,
    projectsDir: path.join(workspaceRoot, 'projects'),
    projectRoot: PROJECT_ROOT
  });

  const checks: Array<{ project: string; result: CheckResult }> = [];
  let requiredFailedCount = 0;
  let optionalFailedCount = 0;

  // Group checks by tier across projects
  const byTier: Record<string, Array<{ projectName: string; item: CheckItem }>> = {};
  for (const p of projects) {
    const projectName = getProjectNameFromSrc(p.src);
    const projectChecks = Array.isArray(p.checks) ? (p.checks as CheckItem[]) : [];
    for (const raw of projectChecks) {
      const item = raw as any as CheckItem;
      // Skip auth checks without install commands: env presence is handled in steps 1/4, testing in step 7.
      if ((item as any).type === 'auth' && !(typeof item.install === 'string' && item.install.trim())) continue;
      const tier = (item as any).tier || DEFAULT_TIER;
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push({ projectName, item });
    }
  }

  for (const tier of TIER_ORDER) {
    const tierChecks = byTier[tier];
    if (!tierChecks || tierChecks.length === 0) continue;
    print(`\n  ${symbols.info} [${tier}] Running project checks...`, 'cyan');
    for (const { projectName, item } of tierChecks) {
      const checkId = makeCheckId('project', projectName, item.name);
      if (executed.has(checkId)) continue;
      const res = await processCheck('project', projectName, item, {
        tier,
        workspaceRoot,
        checkCommand,
        checkHttpAccess,
        isHttpRequest,
        replaceVariablesInObjectWithLog
      });
      checks.push({ project: projectName, result: res });
      trackCheckExecution(checkId, 'setup-projects', res, workspaceRoot);

      const isOptional = (item as any).optional === true;
      if (res.passed === false) {
        if (isOptional) optionalFailedCount++;
        else requiredFailedCount++;
      }
    }
  }

  if (optionalFailedCount > 0) {
    print(`\n${symbols.warning} Step 6 warning: ${optionalFailedCount} optional project check(s) failed`, 'yellow');
  }
  if (requiredFailedCount > 0) {
    print(`\n${symbols.warning} Step 6 warning: ${requiredFailedCount} required project check(s) failed`, 'yellow');
    return { ok: false, result: { checks } };
  }

  print(`\n${symbols.success} Step 6 completed`, 'green');
  return { ok: true, result: { checks } };
}

