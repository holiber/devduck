import fs from 'fs';
import path from 'path';
import { readJSON, writeJSON } from '../lib/config.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import { setupEnvFile } from './env.js';
import { generateMcpJson } from './mcp.js';
import { createInstallLogger, type InstallLogger } from './logger.js';
import { runInstall, type InstallContext, type InstallStep } from './runner.js';
import { print, symbols } from '../utils.js';

export async function installWorkspace(params: {
  workspaceRoot: string;
  projectRoot: string;
  configFilePath: string;
  envFilePath: string;
  cacheDir: string;
  logFilePath: string;
  projectsDir: string;
  autoYes: boolean;
  installModules: string | undefined;
  workspaceConfigPath: string | undefined;
  configFilePathOverride: string | undefined;
  log: (message: string) => void;
  logger: InstallLogger | null;
  getInstallSteps: () => Promise<InstallStep[]>;
}): Promise<void> {
  const {
    workspaceRoot,
    projectRoot,
    configFilePath,
    envFilePath: _envFilePath,
    cacheDir,
    logFilePath,
    projectsDir: _projectsDir,
    autoYes,
    installModules,
    workspaceConfigPath,
    configFilePathOverride,
    log,
    logger,
    getInstallSteps
  } = params;

  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
  }

  let config = readJSON(configFilePath);
  if (!config) {
    const modules = installModules ? installModules.split(',').map((m) => m.trim()) : ['core', 'cursor'];

    let devduckPath = path.relative(workspaceRoot, projectRoot);
    if (!devduckPath || devduckPath === '.') {
      devduckPath = './projects/devduck';
    } else if (!devduckPath.startsWith('.')) {
      devduckPath = './' + devduckPath;
    }

    config = {
      workspaceVersion: '0.1.0',
      devduckPath,
      modules,
      moduleSettings: {},
      repos: [],
      projects: [],
      checks: [],
      env: []
    };

    if (workspaceConfigPath && fs.existsSync(workspaceConfigPath)) {
      const providedWorkspaceConfig = readJSON(workspaceConfigPath);
      if (providedWorkspaceConfig) {
        config = { ...(config as Record<string, unknown>), ...(providedWorkspaceConfig as Record<string, unknown>) };
        if ((providedWorkspaceConfig as { modules?: unknown }).modules) {
          (config as { modules: unknown }).modules = (providedWorkspaceConfig as { modules: unknown }).modules;
        }

        const seedFiles =
          (providedWorkspaceConfig as Record<string, unknown>).seedFiles ??
          (providedWorkspaceConfig as Record<string, unknown>).files;
        const { copySeedFilesFromProvidedWorkspaceConfig } = await import('./installer-utils.js');
        copySeedFilesFromProvidedWorkspaceConfig({
          workspaceRoot,
          providedWorkspaceConfigPath: workspaceConfigPath,
          seedFiles,
          print,
          symbols,
          log
        });
      }
    }

    if (configFilePathOverride && fs.existsSync(configFilePathOverride)) {
      const providedConfig = readJSON(configFilePathOverride);
      if (providedConfig) {
        config = { ...(config as Record<string, unknown>), ...(providedConfig as Record<string, unknown>) };
        if ((providedConfig as { modules?: unknown }).modules) {
          (config as { modules: unknown }).modules = (providedConfig as { modules: unknown }).modules;
        }
      }
    }

    writeJSON(configFilePath, config);
    print(`\n${symbols.success} Created workspace.config.json`, 'green');
    log(
      `Created workspace.config.json with modules: ${
        Array.isArray((config as { modules?: unknown }).modules) ? (config as { modules: string[] }).modules.join(', ') : ''
      }`
    );
  } else {
    if (workspaceConfigPath) {
      print(`\n${symbols.info} workspace.config.json already exists, ignoring --workspace-config`, 'cyan');
      log(`workspace.config.json already exists at ${configFilePath}, ignoring --workspace-config=${workspaceConfigPath}`);
    }
    if (installModules) {
      const modules = installModules.split(',').map((m) => m.trim());
      (config as { modules: string[] }).modules = modules;
      writeJSON(configFilePath, config);
      print(`\n${symbols.info} Updated workspace.config.json with modules: ${modules.join(', ')}`, 'cyan');
      log(`Updated workspace.config.json with modules: ${modules.join(', ')}`);
    }
  }

  await setupEnvFile(workspaceRoot, config as WorkspaceConfig, {
    autoYes,
    log,
    print,
    symbols
  });

  const latestConfig = readJSON(configFilePath) || config;

  let moduleChecks: Array<{ name?: string; mcpSettings?: Record<string, unknown> }> = [];
  try {
    const { getAllModules, resolveModules, loadModuleFromPath } = await import('./module-resolver.js');
    const { loadModulesFromRepo, getDevduckVersion } = await import('../lib/repo-modules.js');

    const allModules = getAllModules();
    const resolvedModules = resolveModules(latestConfig as WorkspaceConfig, allModules);
    moduleChecks = resolvedModules.flatMap((module) => module.checks || []);

    const repos = (latestConfig as WorkspaceConfig).repos;
    if (repos && Array.isArray(repos) && repos.length > 0) {
      const devduckVersion = getDevduckVersion();
      for (const repoUrl of repos) {
        try {
          const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
          if (fs.existsSync(repoModulesPath)) {
            const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
            for (const entry of repoModuleEntries) {
              if (!entry.isDirectory()) continue;
              const modulePath = path.join(repoModulesPath, entry.name);
              const module = loadModuleFromPath(modulePath, entry.name);
              if (module && module.checks) {
                moduleChecks.push(...module.checks);
              }
            }
          }
        } catch {
          // ignore and continue
        }
      }
    }
  } catch {
    // ignore
  }

  generateMcpJson(workspaceRoot, { log, print, symbols, moduleChecks });

  const steps = await getInstallSteps();

  const installLogger = logger ?? createInstallLogger(workspaceRoot, { filePath: logFilePath });

  const ctx: InstallContext = {
    workspaceRoot,
    projectRoot,
    config: latestConfig,
    autoYes,
    logger: installLogger
  };

  const result = await runInstall(steps, ctx);
  if (result.status === 'paused') {
    print(`\n${symbols.warning} Installation paused: Please set missing environment variables and re-run`, 'yellow');
    return;
  }
  if (result.status === 'failed') {
    print(`\n${symbols.error} Installation failed: ${result.error}`, 'red');
    process.exit(1);
  }

  // Install project scripts to workspace package.json
  try {
    const { installProjectScripts } = await import('./install-project-scripts.js');
    print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
    log(`Installing project scripts to workspace package.json`);
    installProjectScripts(workspaceRoot, (config as { projects?: unknown[] }).projects || [], config, log);
    print(`  ${symbols.success} Project scripts installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install project scripts: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install project scripts: ${err.message}\n${err.stack}`);
  }

  // Install API script to workspace package.json
  try {
    const { installApiScript } = await import('./install-project-scripts.js');
    print(`\n${symbols.info} Installing API script to workspace package.json...`, 'cyan');
    log(`Installing API script to workspace package.json`);
    installApiScript(workspaceRoot, log);
    print(`  ${symbols.success} API script installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install API script: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install API script: ${err.message}\n${err.stack}`);
  }

  // Create .cache/devduck directory
  const cacheDevduckDir = path.join(workspaceRoot, '.cache', 'devduck');
  if (!fs.existsSync(cacheDevduckDir)) {
    fs.mkdirSync(cacheDevduckDir, { recursive: true });
  }

  print(`\n${symbols.success} Workspace installation completed!`, 'green');
  log(`Workspace installation completed at ${new Date().toISOString()}`);

  // Ensure cache dir exists (best effort) to match old expectations.
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}


