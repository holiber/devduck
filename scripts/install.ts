#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { print, symbols } from './utils.js';
import { resolveWorkspaceRoot } from './lib/workspace-path.js';
import { fileURLToPath } from 'url';
import { createInstallLogger } from './install/logger.js';
import type { InstallStep } from './install/runner.js';
import type { InstallLogger } from './install/logger.js';
import { showStatus } from './install/status.js';
import { checkTokensOnly } from './install/tokens.js';
import { runSelectedChecks } from './install/selected-checks.js';
import { installWorkspace } from './install/workspace-install.js';
import { runLegacyInstallationCheck } from './install/legacy-install-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
// Script is in scripts/ directory, so project root is parent directory
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Find workspace root by looking for workspace.config.json
 */
function findWorkspaceRoot(startPath = PROJECT_ROOT) {
  let current = path.resolve(startPath);
  const maxDepth = 10;
  let depth = 0;
  
  while (depth < maxDepth) {
    const configPath = path.join(current, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }
    
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    depth++;
  }
  
  return null;
}

// Parse CLI arguments using yargs
const argv = yargs(hideBin(process.argv))
  .option('workspace-path', {
    type: 'string',
    description: 'Path to workspace directory'
  })
  .option('workspace-config', {
    type: 'string',
    description: 'Path to an existing workspace.config.json to use when creating a workspace'
  })
  .option('modules', {
    type: 'string',
    description: 'Comma-separated list of modules to install'
  })
  .option('ai-agent', {
    type: 'string',
    description: 'AI agent to use'
  })
  .option('repo-type', {
    type: 'string',
    description: 'Repository type'
  })
  .option('skip-repo-init', {
    type: 'boolean',
    default: false,
    description: 'Skip repository initialization'
  })
  .option('config', {
    type: 'string',
    description: 'Path to configuration file'
  })
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
  .option('status', {
    type: 'boolean',
    default: false,
    description: 'Show installation status'
  })
  .option('test-checks', {
    type: 'string',
    description: 'Comma-separated list of checks to test (without installation)',
    coerce: (value: string | undefined) =>
      value ? value.split(',').map((c: string) => c.trim()).filter((c: string) => c.length > 0) : null
  })
  .option('checks', {
    type: 'string',
    description: 'Comma-separated list of checks to run (with installation)',
    coerce: (value: string | undefined) =>
      value ? value.split(',').map((c: string) => c.trim()).filter((c: string) => c.length > 0) : null
  })
  .help()
  .alias('help', 'h')
  .argv;

const WORKSPACE_PATH = argv['workspace-path'] as string | undefined;
const WORKSPACE_CONFIG_PATH = argv['workspace-config'] as string | undefined;
const INSTALL_MODULES = argv.modules as string | undefined;
const CONFIG_FILE_PATH = argv.config as string | undefined;

// Determine workspace root
let WORKSPACE_ROOT: string;
if (WORKSPACE_PATH) {
  WORKSPACE_ROOT = resolveWorkspaceRoot(WORKSPACE_PATH, { projectRoot: PROJECT_ROOT, findWorkspaceRoot });
} else {
  WORKSPACE_ROOT = findWorkspaceRoot() || PROJECT_ROOT;
}

const CONFIG_FILE = path.join(WORKSPACE_ROOT, 'workspace.config.json');
const CACHE_DIR = path.join(WORKSPACE_ROOT, '.cache');
// NOTE: `.cache/install-check.json` is deprecated; use `.cache/install-state.json` instead.
const LOG_FILE = path.join(CACHE_DIR, 'install.log');
const ENV_FILE = path.join(WORKSPACE_ROOT, '.env');
const PROJECTS_DIR = path.join(WORKSPACE_ROOT, 'projects');

let installLogger: InstallLogger | null = null;

// CLI flags
const AUTO_YES = argv.y || argv.yes || argv['non-interactive'] || argv.unattended;
const CHECK_TOKENS_ONLY = argv['check-tokens-only'];
const STATUS_ONLY = argv.status;
const TEST_CHECKS = argv['test-checks'];
const CHECKS = argv.checks;

/**
 * Initialize logging
 */
function initLogging() {
  // Ensure cache directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  // Universal pino-compatible logger (levels-only), file sink only.
  // Keep the same log file location.
  installLogger = createInstallLogger(WORKSPACE_ROOT, { filePath: LOG_FILE });
  log(`install.start`);
}

/**
 * Write to log file
 */
function log(message: string): void {
  // Backward-compatible helper for existing code paths.
  // Prefer ctx.logger in new runner/steps.
  if (!installLogger) return;
  installLogger.info(message);
}




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
  if (STATUS_ONLY) {
    await showStatus({ workspaceRoot: WORKSPACE_ROOT, cacheDir: CACHE_DIR });
    return;
  }

  initLogging();

  if (CHECK_TOKENS_ONLY) {
    checkTokensOnly({ configFilePath: CONFIG_FILE, envFilePath: ENV_FILE, log });
    return;
  }

  if (TEST_CHECKS && TEST_CHECKS.length > 0) {
    await runSelectedChecks({
      checkNames: TEST_CHECKS,
      testOnly: true,
      configFilePath: CONFIG_FILE,
      envFilePath: ENV_FILE,
      workspaceRoot: WORKSPACE_ROOT,
      projectRoot: PROJECT_ROOT,
      projectsDir: PROJECTS_DIR,
      log,
      autoYes: AUTO_YES
    });
    return;
  }

  if (CHECKS && CHECKS.length > 0) {
    await runSelectedChecks({
      checkNames: CHECKS,
      testOnly: false,
      configFilePath: CONFIG_FILE,
      envFilePath: ENV_FILE,
      workspaceRoot: WORKSPACE_ROOT,
      projectRoot: PROJECT_ROOT,
      projectsDir: PROJECTS_DIR,
      log,
      autoYes: AUTO_YES
    });
    return;
  }

  if (WORKSPACE_PATH) {
    print(`\n${symbols.search} Installing workspace...\n`, 'blue');
    await installWorkspace({
      workspaceRoot: WORKSPACE_ROOT,
      projectRoot: PROJECT_ROOT,
      configFilePath: CONFIG_FILE,
      envFilePath: ENV_FILE,
      cacheDir: CACHE_DIR,
      logFilePath: LOG_FILE,
      projectsDir: PROJECTS_DIR,
      autoYes: AUTO_YES,
      installModules: INSTALL_MODULES,
      workspaceConfigPath: WORKSPACE_CONFIG_PATH,
      configFilePathOverride: CONFIG_FILE_PATH,
      log,
      logger: installLogger,
      getInstallSteps
    });
    process.exit(0);
  }

  print(`\n${symbols.search} Checking environment installation...\n`, 'blue');
  await runLegacyInstallationCheck({
    workspaceRoot: WORKSPACE_ROOT,
    projectRoot: PROJECT_ROOT,
    configFilePath: CONFIG_FILE,
    autoYes: AUTO_YES,
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
