#!/usr/bin/env node

import path from 'path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { readWorkspaceConfigFile, writeWorkspaceConfigFile } from './lib/workspace-config.js';
import { print, symbols } from './utils.js';
import { fileURLToPath } from 'url';
import { showStatus } from './install/status.js';
import { checkTokensOnly } from './install/tokens.js';
import { runSelectedChecks } from './install/selected-checks.js';
import { createInstallRuntime } from './install/cli-runtime.js';

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

// NOTE: workspace installer moved to scripts/install/workspace-install.ts

function ensureWorkspaceConfigExistsForSync(params: {
  workspaceRoot: string;
  projectRoot: string;
  configFilePath: string;
  installModules: string | undefined;
  workspaceConfigPath: string | undefined;
  configFilePathOverride: string | undefined;
}): void {
  const { workspaceRoot, projectRoot, configFilePath, installModules, workspaceConfigPath, configFilePathOverride } =
    params;

  if (fs.existsSync(configFilePath)) return;

  const modules = installModules ? installModules.split(',').map((m) => m.trim()).filter(Boolean) : ['core', 'cursor'];

  let devduckPath = path.relative(workspaceRoot, projectRoot);
  if (!devduckPath || devduckPath === '.') {
    devduckPath = './projects/devduck';
  } else if (!devduckPath.startsWith('.')) {
    devduckPath = './' + devduckPath;
  }

  let config: Record<string, unknown> = {
    version: '0.1.0',
    devduck_path: devduckPath,
    modules,
    moduleSettings: {},
    repos: [],
    projects: [],
    checks: [],
    env: []
  };

  // Merge optional provided workspace config template first.
  if (workspaceConfigPath && fs.existsSync(workspaceConfigPath)) {
    const providedWorkspaceConfig = readWorkspaceConfigFile<Record<string, unknown>>(workspaceConfigPath);
    if (providedWorkspaceConfig) {
      config = { ...config, ...providedWorkspaceConfig };
      if ((providedWorkspaceConfig as { modules?: unknown }).modules) {
        (config as { modules: unknown }).modules = (providedWorkspaceConfig as { modules: unknown }).modules;
      }
    }
  }

  // Merge --config (installer CLI) next to allow tests to tweak modules/repoType/etc.
  if (configFilePathOverride && fs.existsSync(configFilePathOverride)) {
    const providedConfig = readWorkspaceConfigFile<Record<string, unknown>>(configFilePathOverride);
    if (providedConfig) {
      config = { ...config, ...providedConfig };
      if ((providedConfig as { modules?: unknown }).modules) {
        (config as { modules: unknown }).modules = (providedConfig as { modules: unknown }).modules;
      }
    }
  }

  writeWorkspaceConfigFile(configFilePath, config);
  print(`\n${symbols.success} Created workspace config`, 'green');
  log(`Created workspace config at ${path.relative(workspaceRoot, configFilePath) || 'workspace.config.yml'}`);
}

function runSyncAndInstallViaTaskfile(params: { workspaceRoot: string; autoYes: boolean }): void {
  const { workspaceRoot, autoYes } = params;

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  // 1) Generate `.cache/taskfile.generated.yml` from merged workspace.config.yml (extends aware).
  // Use npx to ensure `tsx` is available even in fresh environments.
  const devduckCliPath = path.join(PROJECT_ROOT, 'scripts', 'devduck-cli.ts');
  const sync = spawnSync(
    npxCmd,
    ['--yes', '-p', 'tsx', 'tsx', devduckCliPath, 'sync', workspaceRoot],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: 'inherit'
    }
  );
  if (sync.status !== 0) {
    throw new Error(`Taskfile sync failed (exit ${sync.status ?? 'unknown'})`);
  }

  // 2) Execute the generated taskfile directly (single source of truth).
  // Use npx to ensure both `task` and `tsx` are available to task commands.
  const generatedTaskfile = path.join(workspaceRoot, '.cache', 'taskfile.generated.yml');
  const taskArgs = [
    '--yes',
    '-p',
    '@go-task/cli',
    '-p',
    'tsx',
    'task',
    '--silent',
    ...(autoYes ? ['--yes'] : []),
    '-t',
    generatedTaskfile,
    'install'
  ];

  const install = spawnSync(npxCmd, taskArgs, {
    cwd: workspaceRoot,
    env: { ...process.env },
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

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

  // Default behavior: rely on Taskfile-generated runtime as the single source of truth.
  print(`\n${symbols.search} Installing workspace (Taskfile)...\n`, 'blue');

  // `devduck-cli sync` expects workspace.config.yml to exist. When running installer on an empty folder
  // (common in Playwright installer tests / fresh workspace installs), create a minimal config first.
  ensureWorkspaceConfigExistsForSync({
    workspaceRoot: paths.workspaceRoot,
    projectRoot: PROJECT_ROOT,
    configFilePath: paths.configFile,
    installModules: flags.installModules,
    workspaceConfigPath: flags.workspaceConfigPath,
    configFilePathOverride: flags.configFilePath
  });
  runSyncAndInstallViaTaskfile({ workspaceRoot: paths.workspaceRoot, autoYes: flags.autoYes });

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
