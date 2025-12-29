#!/usr/bin/env node

import path from 'path';
import { spawnSync } from 'node:child_process';
import { print, symbols } from './utils.js';
import { fileURLToPath } from 'url';
import { showStatus } from './install/status.js';
import { checkTokensOnly } from './install/tokens.js';
import { runSelectedChecks } from './install/selected-checks.js';
import { createInstallRuntime } from './install/cli-runtime.js';
import { installWorkspace } from './install/workspace-install.js';
import {
  installStep1CheckEnv,
  installStep2DownloadRepos,
  installStep3DownloadProjects,
  installStep4CheckEnvAgain,
  installStep5SetupModules,
  installStep6SetupProjects,
  installStep7VerifyInstallation
} from './install/index.js';
import { loadInstallState } from './install/install-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Keep step list very close to the top: CLI plumbing is in ./install/cli-runtime.ts
const runtime = createInstallRuntime(process.argv, PROJECT_ROOT);
const { flags, paths, initLogging, log } = runtime;

// NOTE: check execution helpers were moved to scripts/install/check-engine.ts

// NOTE: selected checks runner moved to scripts/install/selected-checks.ts

// NOTE: status/tokens helpers were moved to scripts/install/status.ts and scripts/install/tokens.ts

// NOTE: seed-files copy helpers were moved to ./install/installer-utils.ts

// NOTE: workspace installer lives in scripts/install/workspace-install.ts

/**
 * Main installation check function
 */
async function main(): Promise<void> {
  const isNpmInstallLifecycle = process.env.npm_lifecycle_event === 'install' || process.env.npm_command === 'install';

  if (flags.statusOnly) {
    await showStatus({ workspaceRoot: paths.workspaceRoot, cacheDir: paths.cacheDir });
    return;
  }

  initLogging();

  if (flags.checkTokensOnly) {
    checkTokensOnly({ configFilePath: paths.configFile, envFilePath: paths.envFile, log });
    return;
  }

  if (flags.testChecks && flags.testChecks.length > 0) {
    await runSelectedChecks({
      checkNames: flags.testChecks,
      testOnly: true,
      configFilePath: paths.configFile,
      envFilePath: paths.envFile,
      workspaceRoot: paths.workspaceRoot,
      projectRoot: PROJECT_ROOT,
      projectsDir: paths.projectsDir,
      log,
      autoYes: flags.autoYes
    });
    return;
  }

  if (flags.checks && flags.checks.length > 0) {
    await runSelectedChecks({
      checkNames: flags.checks,
      testOnly: false,
      configFilePath: paths.configFile,
      envFilePath: paths.envFile,
      workspaceRoot: paths.workspaceRoot,
      projectRoot: PROJECT_ROOT,
      projectsDir: paths.projectsDir,
      log,
      autoYes: flags.autoYes
    });
    return;
  }

  // Default behavior: run the canonical installer steps (works for fresh workspaces and CI tests).
  print(`\n${symbols.search} Installing workspace...\n`, 'blue');

  const result = await installWorkspace({
    workspaceRoot: paths.workspaceRoot,
    projectRoot: PROJECT_ROOT,
    configFilePath: paths.configFile,
    envFilePath: paths.envFile,
    cacheDir: paths.cacheDir,
    logFilePath: paths.logFile,
    projectsDir: paths.projectsDir,
    autoYes: flags.autoYes,
    installModules: flags.installModules,
    workspaceConfigPath: flags.workspaceConfigPath,
    configFilePathOverride: flags.configFilePath,
    log,
    logger: runtime.getLogger(),
    getInstallSteps: async () => [
      { id: 'check-env', title: 'Check environment variables', run: installStep1CheckEnv },
      { id: 'download-repos', title: 'Download repositories', run: installStep2DownloadRepos },
      { id: 'download-projects', title: 'Download projects', run: installStep3DownloadProjects },
      { id: 'check-env-again', title: 'Check environment variables again', run: installStep4CheckEnvAgain },
      { id: 'setup-modules', title: 'Setup extensions', run: installStep5SetupModules },
      { id: 'setup-projects', title: 'Setup projects', run: installStep6SetupProjects },
      { id: 'verify-installation', title: 'Verify installation', run: installStep7VerifyInstallation }
    ]
  });

  if (result.status !== 'completed') {
    if (result.status === 'failed') {
      const state = loadInstallState(paths.workspaceRoot);
      const executed = Array.isArray(state.executedChecks) ? state.executedChecks : [];
      const total = executed.filter((c) => c.passed !== null).length;
      const passed = executed.filter((c) => c.passed === true).length;

      print('\nINSTALLATION FINISHED WITH ERRORS', 'red');
      print(`Checks: ${passed}/${total} passed`, 'red');
      print(`See log: .cache/install.log`, 'red');
    }
    process.exit(1);
  }

  // Keep compatibility with npm install lifecycle expectations.
  if (isNpmInstallLifecycle) process.exit(0);
  process.exit(0);
}

// Run main function
main().catch(async (error) => {
  const err = error as Error;
  print(`\n${symbols.error} Fatal error: ${err.message}`, 'red');
    log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
