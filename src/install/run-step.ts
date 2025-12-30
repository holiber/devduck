#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'node:url';

import { findWorkspaceRoot } from '../lib/workspace-root.js';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { createInstallLogger } from './logger.js';
import type { InstallStepId, StepOutcome } from './runner.js';

const STEP_IDS: InstallStepId[] = [
  'check-env',
  'download-repos',
  'download-projects',
  'check-env-again',
  'setup-modules',
  'setup-projects',
  'verify-installation'
];

const STEP_DESCRIPTIONS: Record<InstallStepId, string> = {
  'check-env': 'Verify required environment variables',
  'download-repos': 'Download external extension repositories',
  'download-projects': 'Clone/link workspace projects',
  'check-env-again': 'Re-check environment variables',
  'setup-modules': 'Setup all Barducks extensions',
  'setup-projects': 'Setup all workspace projects',
  'verify-installation': 'Verify installation correctness'
};

function printStepBanner(stepId: InstallStepId): void {
  const idx = STEP_IDS.indexOf(stepId);
  const n = idx >= 0 ? idx + 1 : 0;
  const total = STEP_IDS.length;
  const desc = STEP_DESCRIPTIONS[stepId] || stepId;
  // eslint-disable-next-line no-console
  console.log(`\n==> Step ${n}/${total}: ${desc}`);
}

function ensureCacheDir(workspaceRoot: string): string {
  const cacheDir = path.join(workspaceRoot, '.cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function exitForOutcome(outcome: StepOutcome): never {
  if (outcome.status === 'ok') process.exit(0);
  if (outcome.status === 'needs_input') process.exit(2);
  process.exit(1);
}

async function main(argv = process.argv): Promise<void> {
  const parsed = yargs(hideBin(argv))
    .scriptName('barducks-install-step')
    .command(
      '$0 <stepId>',
      'Run a single Barducks installer step',
      (yy) =>
        yy
          .positional('stepId', {
            type: 'string',
            describe: `Install step id (${STEP_IDS.join(', ')})`,
            demandOption: true
          })
          .option('workspace-root', {
            type: 'string',
            describe: 'Workspace root directory (defaults to auto-detected)',
            default: ''
          })
          .option('project-root', {
            type: 'string',
            describe: 'Barducks project root directory (defaults to auto-detected)',
            default: ''
          })
          .option('y', {
            alias: ['yes', 'non-interactive', 'unattended'],
            type: 'boolean',
            default: false,
            describe: 'Non-interactive mode (auto-yes)'
          }),
      () => {}
    )
    .strict()
    .help()
    .parseSync();

  const stepIdRaw = String(parsed.stepId || '').trim();
  if (!STEP_IDS.includes(stepIdRaw as InstallStepId)) {
    throw new Error(`Unknown stepId: ${stepIdRaw}. Expected one of: ${STEP_IDS.join(', ')}`);
  }
  const stepId = stepIdRaw as InstallStepId;

  // Avoid duplicate banners: Taskfile install prints our banner here,
  // and step implementations have their own "[Step N]" console headers.
  // Keep step headers for direct/legacy runs, but suppress them for this launcher.
  if (process.env.BARDUCKS_SUPPRESS_STEP_HEADER !== '1') process.env.BARDUCKS_SUPPRESS_STEP_HEADER = '1';
  printStepBanner(stepId);

  const invocationCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
  const workspaceRoot =
    (parsed['workspace-root'] ? path.resolve(invocationCwd, String(parsed['workspace-root'])) : null) ||
    findWorkspaceRoot(invocationCwd) ||
    invocationCwd;

  const cacheDir = ensureCacheDir(workspaceRoot);
  const logFile = path.join(cacheDir, 'install.log');
  const logger = createInstallLogger(workspaceRoot, { filePath: logFile });

  const { config } = readWorkspaceConfigFromRoot(workspaceRoot);
  const projectRoot =
    (parsed['project-root'] ? path.resolve(invocationCwd, String(parsed['project-root'])) : null) ||
    // This file lives at <barducksRoot>/src/install/run-step.ts => ../.. is <barducksRoot>
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const autoYes = Boolean(parsed.y || parsed.yes || parsed['non-interactive'] || parsed.unattended);

  const steps = await import('./index.js');
  const stepFnById: Record<InstallStepId, (ctx: any) => Promise<StepOutcome>> = {
    'check-env': steps.installStep1CheckEnv,
    'download-repos': steps.installStep2DownloadRepos,
    'download-projects': steps.installStep3DownloadProjects,
    'check-env-again': steps.installStep4CheckEnvAgain,
    'setup-modules': steps.installStep5SetupModules,
    'setup-projects': steps.installStep6SetupProjects,
    'verify-installation': steps.installStep7VerifyInstallation
  };

  const fn = stepFnById[stepId];
  const outcome = await fn({
    workspaceRoot,
    projectRoot,
    config,
    autoYes,
    logger
  });

  exitForOutcome(outcome);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error((e as Error)?.stack || (e as Error)?.message || String(e));
    process.exit(1);
  });
}

export { main };

