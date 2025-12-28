import fs from 'fs';
import path from 'path';
import { readJSON } from '../lib/config.js';
import { readWorkspaceConfigFile, readWorkspaceConfigFromRoot, writeWorkspaceConfigFile } from '../lib/workspace-config.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import YAML from 'yaml';
import { setupEnvFile } from './env.js';
import { generateMcpJson } from './mcp.js';
import { createInstallLogger, type InstallLogger } from './logger.js';
import { runInstall, type InstallContext, type InstallStep, type RunInstallResult } from './runner.js';
import { print, symbols } from '../utils.js';
import { loadInstallState, saveInstallState } from './install-state.js';

type GeneratedTaskfile = {
  version: string;
  output?: string;
  vars?: Record<string, string>;
  tasks: Record<string, unknown>;
};

function ensureWorkspaceTaskfile(workspaceRoot: string, devduckPathRel: string): void {
  const taskfilePath = path.join(workspaceRoot, 'Taskfile.yml');
  if (fs.existsSync(taskfilePath)) return;

  const includePath = path.posix.join(devduckPathRel.replace(/\\/g, '/'), 'defaults', 'install.taskfile.yml');
  const content =
    `version: '3'\n` +
    `output: interleaved\n\n` +
    `includes:\n` +
    `  devduck:\n` +
    `    taskfile: ${includePath}\n\n` +
    `tasks:\n` +
    `  sync:\n` +
    `    desc: "Generate .cache/taskfile.generated.yml from workspace config"\n` +
    `    cmds:\n` +
    `      - task: devduck:sync\n\n` +
    `  install:\n` +
    `    desc: "Run full installation sequence (Steps 1–7)"\n` +
    `    cmds:\n` +
    `      - task: devduck:install\n`;

  fs.writeFileSync(taskfilePath, content, 'utf8');
}

function buildGeneratedTaskfile(
  devduckPathRel: string,
  config?: Record<string, unknown>
): GeneratedTaskfile {
  // If config has a taskfile section, use it; otherwise fall back to hardcoded defaults
  if (config?.taskfile && typeof config.taskfile === 'object') {
    const taskfile = config.taskfile as {
      vars?: Record<string, string>;
      tasks?: Record<string, unknown>;
    };
    
    return {
      version: '3',
      output: 'interleaved',
      vars: {
        ...(taskfile.vars || {}),
        // Always inject/ensure these vars (they override any from config)
        DEVDUCK_ROOT: devduckPathRel,
        WORKSPACE_ROOT: '{{ default "." .WORKSPACE_ROOT }}'
      },
      tasks: taskfile.tasks || {}
    };
  }
  
  // Fallback: hardcoded defaults for backward compatibility
  const stepCmd = (stepId: string) =>
    `tsx {{.DEVDUCK_ROOT}}/scripts/install/run-step.ts ${stepId} --workspace-root {{.WORKSPACE_ROOT}} --project-root {{.DEVDUCK_ROOT}} --unattended`;

  return {
    version: '3',
    output: 'interleaved',
    vars: {
      DEVDUCK_ROOT: devduckPathRel,
      WORKSPACE_ROOT: '{{ default "." .WORKSPACE_ROOT }}'
    },
    tasks: {
      install: {
        desc: 'Run full installation sequence (Steps 1–7)',
        cmds: [
          { task: 'install:1-check-env' },
          { task: 'install:2-download-repos' },
          { task: 'install:3-download-projects' },
          { task: 'install:4-check-env-again' },
          { task: 'install:5-setup-modules' },
          { task: 'install:6-setup-projects' },
          { task: 'install:7-verify-installation' }
        ]
      },
      'install:1-check-env': { desc: 'Verify required environment variables', cmds: [stepCmd('check-env')] },
      'install:2-download-repos': { desc: 'Download external module repositories', cmds: [stepCmd('download-repos')] },
      'install:3-download-projects': { desc: 'Clone/link workspace projects', cmds: [stepCmd('download-projects')] },
      'install:4-check-env-again': { desc: 'Re-check environment variables', cmds: [stepCmd('check-env-again')] },
      'install:5-setup-modules': { desc: 'Setup all DevDuck modules', cmds: [stepCmd('setup-modules')] },
      'install:6-setup-projects': { desc: 'Setup all workspace projects', cmds: [stepCmd('setup-projects')] },
      'install:7-verify-installation': { desc: 'Verify installation correctness', cmds: [stepCmd('verify-installation')] }
    }
  };
}

function ensureGeneratedTaskfile(
  workspaceRoot: string,
  cacheDir: string,
  devduckPathRel: string,
  config?: Record<string, unknown>
): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  const generatedPath = path.join(cacheDir, 'taskfile.generated.yml');
  const generated = buildGeneratedTaskfile(devduckPathRel, config);
  const out = YAML.stringify(generated);
  fs.writeFileSync(generatedPath, out.endsWith('\n') ? out : out + '\n', 'utf8');
  ensureWorkspaceTaskfile(workspaceRoot, devduckPathRel);
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
    const modules = installModules ? installModules.split(',').map((m) => m.trim()) : ['core', 'cursor'];

    let devduckPath = path.relative(workspaceRoot, projectRoot);
    if (!devduckPath || devduckPath === '.') {
      devduckPath = './projects/devduck';
    } else if (!devduckPath.startsWith('.')) {
      devduckPath = './' + devduckPath;
    }

    config = {
      version: '0.1.0',
      devduck_path: devduckPath,
      modules,
      moduleSettings: {},
      repos: [],
      projects: [],
      checks: [],
      env: []
    };

    if (workspaceConfigPath && fs.existsSync(workspaceConfigPath)) {
      const providedWorkspaceConfig = readWorkspaceConfigFile<Record<string, unknown>>(workspaceConfigPath);
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
      const providedConfig = readWorkspaceConfigFile<Record<string, unknown>>(configFilePathOverride);
      if (providedConfig) {
        config = { ...(config as Record<string, unknown>), ...(providedConfig as Record<string, unknown>) };
        if ((providedConfig as { modules?: unknown }).modules) {
          (config as { modules: unknown }).modules = (providedConfig as { modules: unknown }).modules;
        }
      }
    }

    writeWorkspaceConfigFile(configFilePath, config);
    print(`\n${symbols.success} Created workspace config`, 'green');
    log(
      `Created workspace config with modules: ${
        Array.isArray((config as { modules?: unknown }).modules) ? (config as { modules: string[] }).modules.join(', ') : ''
      }`
    );
  } else {
    if (workspaceConfigPath) {
      print(`\n${symbols.info} Workspace config already exists, ignoring --workspace-config`, 'cyan');
      log(`Workspace config already exists at ${configFilePath}, ignoring --workspace-config=${workspaceConfigPath}`);
    }
    if (installModules) {
      const modules = installModules.split(',').map((m) => m.trim());
      (config as { modules: string[] }).modules = modules;
      writeWorkspaceConfigFile(configFilePath, config);
      print(`\n${symbols.info} Updated workspace config with modules: ${modules.join(', ')}`, 'cyan');
      log(`Updated workspace config with modules: ${modules.join(', ')}`);
    }
  }

  await setupEnvFile(workspaceRoot, config as WorkspaceConfig, {
    autoYes,
    log,
    print,
    symbols
  });

  const latestConfig = readWorkspaceConfigFile<Record<string, unknown>>(configFilePath) || config;
  {
    const devduckPathRel =
      typeof (latestConfig as { devduck_path?: unknown }).devduck_path === 'string' &&
      String((latestConfig as { devduck_path?: unknown }).devduck_path).trim().length > 0
        ? String((latestConfig as { devduck_path?: unknown }).devduck_path).trim()
        : './projects/devduck';
    // This is a convenience for Taskfile-based workflows: keep runtime taskfile in .cache updated.
    // Load config with extends to get merged taskfile section
    const { config: mergedConfig } = readWorkspaceConfigFromRoot<Record<string, unknown>>(workspaceRoot, {
      withExtends: true
    });
    ensureGeneratedTaskfile(workspaceRoot, cacheDir, devduckPathRel, mergedConfig || latestConfig);
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

  generateMcpJson(workspaceRoot, { log, print, symbols, moduleChecks });

  // Check MCP servers (canonical results persisted into install-state.json)
  try {
    const { readJSON } = await import('../lib/config.js');
    const { checkMcpServers } = await import('./mcp.js');
    const mcpJsonPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
    const mcpConfig = readJSON(mcpJsonPath) as { mcpServers?: Record<string, Record<string, unknown>> } | null;
    const mcpServers = mcpConfig?.mcpServers || {};
    const mcpResults = await checkMcpServers(mcpServers, workspaceRoot, { log, print, symbols });
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

  log(`Workspace installation completed at ${new Date().toISOString()}`);

  // Ensure cache dir exists (best effort) to match old expectations.
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  return result;
}


