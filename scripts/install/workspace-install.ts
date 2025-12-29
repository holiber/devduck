import fs from 'fs';
import path from 'path';
import { readWorkspaceConfigFile, readWorkspaceConfigFromRoot, writeWorkspaceConfigFile } from '../lib/workspace-config.js';
import YAML from 'yaml';
import { buildGeneratedTaskfile } from '../lib/taskfile-gen.js';
import { setupEnvFile } from './env.js';
import { generateMcpJson } from './mcp.js';
import { createInstallLogger, type InstallLogger } from './logger.js';
import { runInstall, type InstallContext, type InstallStep, type RunInstallResult } from './runner.js';
import { print, symbols } from '../utils.js';
import { loadInstallState, saveInstallState } from './install-state.js';

type WorkspaceConfig = Record<string, unknown> & {
  version?: string | number;
  devduck_path?: string;
  repos?: string[];
  extensions?: string[];
  modules?: string[]; // legacy
  projects?: unknown[];
  checks?: unknown[];
  env?: Array<{ name: string; default?: string; description?: string }>;
};

type WorkspaceConfigLike = Record<string, unknown> & {
  devduck_path?: string;
  taskfile?: {
    output?: string;
    vars?: Record<string, unknown>;
    tasks?: Record<string, unknown>;
  };
};

function ensureGeneratedTaskfile(
  workspaceRoot: string,
  cacheDir: string,
  devduckPathRel: string,
  config: WorkspaceConfigLike
): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  const generatedPath = path.join(cacheDir, 'taskfile.generated.yml');
  const generated = buildGeneratedTaskfile({ workspaceRoot, config, devduckPathRel });
  const out = YAML.stringify(generated);
  fs.writeFileSync(generatedPath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

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
}): Promise<RunInstallResult> {
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

  let config = readWorkspaceConfigFile<Record<string, unknown>>(configFilePath);
  if (!config) {
    const extensions = installModules ? installModules.split(',').map((m) => m.trim()) : ['core', 'cursor'];

    let devduckPath = path.relative(workspaceRoot, projectRoot);
    if (!devduckPath || devduckPath === '.') {
      devduckPath = './projects/barducks';
    } else if (!devduckPath.startsWith('.')) {
      devduckPath = './' + devduckPath;
    }

    config = {
      version: '0.1.0',
      devduck_path: devduckPath,
      extensions,
      extensionSettings: {},
      repos: [],
      projects: [],
      checks: [],
      env: []
    };

    if (workspaceConfigPath && fs.existsSync(workspaceConfigPath)) {
      const providedWorkspaceConfig = readWorkspaceConfigFile<Record<string, unknown>>(workspaceConfigPath);
      if (providedWorkspaceConfig) {
        config = { ...(config as Record<string, unknown>), ...(providedWorkspaceConfig as Record<string, unknown>) };
        const provided = providedWorkspaceConfig as { extensions?: unknown; modules?: unknown };
        if (provided.extensions) (config as { extensions: unknown }).extensions = provided.extensions;
        else if (provided.modules) (config as { extensions: unknown }).extensions = provided.modules;

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
      const providedConfig = readWorkspaceConfigFile<Record<string, unknown>>(configFilePathOverride);
      if (providedConfig) {
        config = { ...(config as Record<string, unknown>), ...(providedConfig as Record<string, unknown>) };
        const provided = providedConfig as { extensions?: unknown; modules?: unknown };
        if (provided.extensions) (config as { extensions: unknown }).extensions = provided.extensions;
        else if (provided.modules) (config as { extensions: unknown }).extensions = provided.modules;
      }
    }

    writeWorkspaceConfigFile(configFilePath, config);
    print(`\n${symbols.success} Created workspace config`, 'green');
    log(
      `Created workspace config with extensions: ${
        Array.isArray((config as { extensions?: unknown }).extensions)
          ? (config as { extensions: string[] }).extensions.join(', ')
          : ''
      }`
    );
  } else {
    if (workspaceConfigPath) {
      print(`\n${symbols.info} Workspace config already exists, ignoring --workspace-config`, 'cyan');
      log(`Workspace config already exists at ${configFilePath}, ignoring --workspace-config=${workspaceConfigPath}`);
    }
    if (installModules) {
      const extensions = installModules.split(',').map((m) => m.trim());
      (config as { extensions: string[] }).extensions = extensions;
      writeWorkspaceConfigFile(configFilePath, config);
      print(`\n${symbols.info} Updated workspace config with extensions: ${extensions.join(', ')}`, 'cyan');
      log(`Updated workspace config with extensions: ${extensions.join(', ')}`);
    }
  }

  await setupEnvFile(workspaceRoot, config as WorkspaceConfig, {
    autoYes,
    log,
    print: print as unknown as (msg: string, color?: string) => void,
    symbols
  });

  const latestConfig = readWorkspaceConfigFile<Record<string, unknown>>(configFilePath) || config;
  const resolvedConfig =
    readWorkspaceConfigFromRoot<WorkspaceConfigLike>(workspaceRoot).config || (latestConfig as WorkspaceConfigLike);
  {
    const devduckPathRel =
      typeof resolvedConfig.devduck_path === 'string' && resolvedConfig.devduck_path.trim().length > 0
        ? resolvedConfig.devduck_path.trim()
        : './projects/barducks';
    // This is a convenience for Taskfile-based workflows: keep runtime taskfile in .cache updated.
    ensureGeneratedTaskfile(workspaceRoot, cacheDir, devduckPathRel, resolvedConfig);
  }

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

  generateMcpJson(workspaceRoot, { log, print: print as unknown as (msg: string, color?: string) => void, symbols, moduleChecks });

  // Check MCP servers (canonical results persisted into install-state.json)
  try {
    const { readJSON } = await import('../lib/config.js');
    const { checkMcpServers } = await import('./mcp.js');
    const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
    const mcpConfig = readJSON(mcpJsonPath) as { mcpServers?: Record<string, Record<string, unknown>> } | null;
    const mcpServers = mcpConfig?.mcpServers || {};
    const mcpResults = await checkMcpServers(mcpServers, workspaceRoot, { log, print: print as unknown as (msg: string, color?: string) => void, symbols });
    const state = loadInstallState(workspaceRoot);
    state.mcpServers = mcpResults as unknown[];
    saveInstallState(workspaceRoot, state);
  } catch {
    // ignore MCP check failures here; they will be reflected via missing results and/or later checks
  }

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
    return result;
  }
  if (result.status === 'failed') {
    print(`\n${symbols.error} Installation failed: ${result.error}`, 'red');
    return result;
  }

  // Install project scripts to workspace package.json
  try {
    const { installProjectScripts } = await import('./install-project-scripts.js');
    print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
    log(`Installing project scripts to workspace package.json`);
    installProjectScripts(workspaceRoot, ((config as { projects?: unknown[] }).projects || []) as unknown as any[], config, log);
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

  log(`Workspace installation completed at ${new Date().toISOString()}`);

  // Ensure cache dir exists (best effort) to match old expectations.
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  return result;
}


