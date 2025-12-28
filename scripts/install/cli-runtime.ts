import fs from 'fs';
import path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { resolveWorkspaceRoot } from '../lib/workspace-path.js';
import { getWorkspaceConfigFilePath } from '../lib/workspace-config.js';
import { findWorkspaceRoot } from '../lib/workspace-root.js';
import { createInstallLogger, type InstallLogger } from './logger.js';

export type InstallCliFlags = {
  workspacePath?: string;
  workspaceConfigPath?: string;
  installModules?: string;
  configFilePath?: string;
  autoYes: boolean;
  checkTokensOnly: boolean;
  statusOnly: boolean;
  testChecks: string[] | null;
  checks: string[] | null;
};

export type InstallPaths = {
  projectRoot: string;
  workspaceRoot: string;
  configFile: string;
  cacheDir: string;
  logFile: string;
  envFile: string;
  projectsDir: string;
};

function findWorkspaceRootCompat(startPath: string): string | null {
  // Shared, YAML-only workspace root detection (also throws on legacy JSON).
  return findWorkspaceRoot(startPath);
}

function parseCommaList(value: string | undefined): string[] | null {
  if (!value) return null;
  return value
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function createInstallRuntime(argv: string[], projectRoot: string): {
  flags: InstallCliFlags;
  paths: InstallPaths;
  initLogging: () => void;
  log: (message: string) => void;
  getLogger: () => InstallLogger | null;
} {
  // Parse CLI arguments using yargs
  const parsed = yargs(hideBin(argv))
    .option('workspace-path', { type: 'string', description: 'Path to workspace directory' })
    .option('workspace-config', {
      type: 'string',
      description: 'Path to an existing workspace.config.yml to use when creating a workspace'
    })
    .option('modules', { type: 'string', description: 'Comma-separated list of modules to install' })
    // Keep these options for compatibility even if not currently used in code paths.
    .option('ai-agent', { type: 'string', description: 'AI agent to use' })
    .option('repo-type', { type: 'string', description: 'Repository type' })
    .option('skip-repo-init', { type: 'boolean', default: false, description: 'Skip repository initialization' })
    .option('config', { type: 'string', description: 'Path to configuration file' })
    .option('y', {
      alias: ['yes', 'non-interactive', 'unattended'],
      type: 'boolean',
      default: false,
      description: 'Non-interactive mode (auto-yes)'
    })
    .option('check-tokens-only', {
      type: 'boolean',
      default: false,
      description: 'Only check if required tokens are present'
    })
    .option('status', { type: 'boolean', default: false, description: 'Show installation status' })
    .option('test-checks', {
      type: 'string',
      description: 'Comma-separated list of checks to test (without installation)',
      coerce: parseCommaList
    })
    .option('checks', {
      type: 'string',
      description: 'Comma-separated list of checks to run (with installation)',
      coerce: parseCommaList
    })
    .help()
    .alias('help', 'h')
    .argv as unknown as Record<string, unknown>;

  const workspacePath = parsed['workspace-path'] as string | undefined;
  const workspaceConfigPath = parsed['workspace-config'] as string | undefined;
  const installModules = parsed['modules'] as string | undefined;
  const configFilePath = parsed['config'] as string | undefined;

  const autoYes = Boolean(
    parsed['y'] || parsed['yes'] || parsed['non-interactive'] || parsed['unattended']
  );
  const checkTokensOnly = Boolean(parsed['check-tokens-only']);
  const statusOnly = Boolean(parsed['status']);
  const testChecks = (parsed['test-checks'] as string[] | null) ?? null;
  const checks = (parsed['checks'] as string[] | null) ?? null;

  let workspaceRoot: string;
  if (workspacePath) {
    workspaceRoot = resolveWorkspaceRoot(workspacePath, { projectRoot, findWorkspaceRoot: findWorkspaceRootCompat });
  } else {
    workspaceRoot = findWorkspaceRootCompat(projectRoot) || projectRoot;
  }

  const cacheDir = path.join(workspaceRoot, '.cache');
  const logFile = path.join(cacheDir, 'install.log');

  const paths: InstallPaths = {
    projectRoot,
    workspaceRoot,
    configFile: getWorkspaceConfigFilePath(workspaceRoot),
    cacheDir,
    logFile,
    envFile: path.join(workspaceRoot, '.env'),
    projectsDir: path.join(workspaceRoot, 'projects')
  };

  let installLogger: InstallLogger | null = null;

  const initLogging = () => {
    if (!fs.existsSync(paths.cacheDir)) {
      fs.mkdirSync(paths.cacheDir, { recursive: true });
    }
    installLogger = createInstallLogger(paths.workspaceRoot, { filePath: paths.logFile });
    log(`install.start`);
  };

  const log = (message: string) => {
    if (!installLogger) return;
    installLogger.info(message);
  };

  return {
    flags: {
      workspacePath,
      workspaceConfigPath,
      installModules,
      configFilePath,
      autoYes,
      checkTokensOnly,
      statusOnly,
      testChecks,
      checks
    },
    paths,
    initLogging,
    log,
    getLogger: () => installLogger
  };
}


