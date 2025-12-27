#!/usr/bin/env node

import path from 'path';
import { print, symbols } from './utils.js';
import { fileURLToPath } from 'url';
import type { InstallStep } from './install/runner.js';
import { showStatus } from './install/status.js';
import { checkTokensOnly } from './install/tokens.js';
import { runSelectedChecks } from './install/selected-checks.js';
import { installWorkspace } from './install/workspace-install.js';
import { runLegacyInstallationCheck } from './install/legacy-install-check.js';
import { createInstallRuntime } from './install/cli-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Keep step list very close to the top: CLI plumbing is in ./install/cli-runtime.ts
const runtime = createInstallRuntime(process.argv, PROJECT_ROOT);
const { flags, paths, initLogging, log, getLogger } = runtime;




// Installer step definitions are intentionally near the top of the file so that
// developers can see the workflow without scrolling through implementation details.
const INSTALL_STEPS_META = [
  {
    id: 'check-env',
    title: 'Check Environment Variables',
    description: 'Verify required env variables exist in config/modules/projects.'
  },
  {
    id: 'download-repos',
    title: 'Download Repositories',
    description: 'Clone or update external repositories under devduck/.'
  },
  {
    id: 'download-projects',
    title: 'Download Projects',
    description: 'Clone or link projects into projects/.'
  },
  {
    id: 'check-env-again',
    title: 'Check Environment Again',
    description: 'Re-check env after repos/projects are available.'
  },
  {
    id: 'setup-modules',
    title: 'Setup Modules',
    description: 'Run module hooks and checks.'
  },
  {
    id: 'setup-projects',
    title: 'Setup Projects',
    description: 'Run project checks and finalize setup.'
  },
  {
    id: 'verify-installation',
    title: 'Verify Installation',
    description: 'Run verification checks.'
  }
] as const;

async function getInstallSteps(): Promise<InstallStep[]> {
  const {
    installStep1CheckEnv,
    installStep2DownloadRepos,
    installStep3DownloadProjects,
    installStep4CheckEnvAgain,
    installStep5SetupModules,
    installStep6SetupProjects,
    installStep7VerifyInstallation
  } = await import('./install/index.js');

  return [
    { ...INSTALL_STEPS_META[0], run: installStep1CheckEnv },
    { ...INSTALL_STEPS_META[1], run: installStep2DownloadRepos },
    { ...INSTALL_STEPS_META[2], run: installStep3DownloadProjects },
    { ...INSTALL_STEPS_META[3], run: installStep4CheckEnvAgain },
    { ...INSTALL_STEPS_META[4], run: installStep5SetupModules },
    { ...INSTALL_STEPS_META[5], run: installStep6SetupProjects },
    { ...INSTALL_STEPS_META[6], run: installStep7VerifyInstallation }
  ];
}

// NOTE: check execution helpers were moved to scripts/install/check-engine.ts

// NOTE: selected checks runner moved to scripts/install/selected-checks.ts

// NOTE: status/tokens helpers were moved to scripts/install/status.ts and scripts/install/tokens.ts

// NOTE: seed-files copy helpers were moved to ./install/installer-utils.ts

// NOTE: workspace installer moved to scripts/install/workspace-install.ts

/**
 * Main installation check function
 */
async function main(): Promise<void> {
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

  if (flags.workspacePath) {
    print(`\n${symbols.search} Installing workspace...\n`, 'blue');
    await installWorkspace({
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
      logger: getLogger(),
      getInstallSteps
    });
    process.exit(0);
  }

  print(`\n${symbols.search} Checking environment installation...\n`, 'blue');
  await runLegacyInstallationCheck({
    workspaceRoot: paths.workspaceRoot,
    projectRoot: PROJECT_ROOT,
    configFilePath: paths.configFile,
    autoYes: flags.autoYes,
    log
  });
}

// Run main function
main().catch(async (error) => {
  const err = error as Error;
  print(`\n${symbols.error} Fatal error: ${err.message}`, 'red');
    log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
