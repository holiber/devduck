#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'url';

import { print, symbols } from './utils.js';
import { resolveWorkspaceRoot } from './lib/workspace-path.js';
import { readJSON, writeJSON } from './lib/config.js';
import { setupEnvFile } from './install/env.js';
import { runInstallSteps } from './install/install.js';
import { readInstallState, getInstallStatePath } from './install/install-state.js';

import type { WorkspaceConfig } from './schemas/workspace-config.zod.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    if (fs.existsSync(configPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    depth++;
  }

  return null;
}

// CLI args
const argv = yargs(hideBin(process.argv))
  .option('workspace-path', { type: 'string', description: 'Path to workspace directory' })
  .option('workspace-config', { type: 'string', description: 'Path to an existing workspace.config.json to use when creating a workspace' })
  .option('modules', { type: 'string', description: 'Comma-separated list of modules to install' })
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
  .option('status', { type: 'boolean', default: false, description: 'Show installation status' })
  .help()
  .alias('help', 'h')
  .argv;

const WORKSPACE_PATH = argv['workspace-path'];
const WORKSPACE_CONFIG_PATH = argv['workspace-config'];
const INSTALL_MODULES = argv.modules;
const CONFIG_FILE_PATH = argv.config;
const AUTO_YES = argv.y || argv.yes || argv['non-interactive'] || argv.unattended;
const STATUS_ONLY = argv.status;

// Determine workspace root
let WORKSPACE_ROOT: string;
if (WORKSPACE_PATH) {
  WORKSPACE_ROOT = resolveWorkspaceRoot(WORKSPACE_PATH, { projectRoot: PROJECT_ROOT, findWorkspaceRoot });
} else {
  WORKSPACE_ROOT = findWorkspaceRoot() || PROJECT_ROOT;
}

const CONFIG_FILE = path.join(WORKSPACE_ROOT, 'workspace.config.json');
const CACHE_DIR = path.join(WORKSPACE_ROOT, '.cache');
const LOG_FILE = path.join(CACHE_DIR, 'install.log');

let logStream: fs.WriteStream | null = null;

function initLogging() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  log(`\n=== Installer started at ${new Date().toISOString()} ===\n`);
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  if (logStream) logStream.write(`[${timestamp}] ${message}\n`);
}

function getDirectorySize(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return stats.size;
    let size = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) size += getDirectorySize(entryPath);
      else size += fs.statSync(entryPath).size;
    }
    return size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function showStatus(): void {
  const statePath = getInstallStatePath(WORKSPACE_ROOT);
  if (!fs.existsSync(statePath)) {
    process.stdout.write('');
    process.exit(0);
  }

  try {
    const statusData = readInstallState(WORKSPACE_ROOT);
    const cacheSize = getDirectorySize(CACHE_DIR);
    const output = {
      status: statusData,
      cacheSize,
      cacheSizeFormatted: formatBytes(cacheSize)
    };
    process.stdout.write(JSON.stringify(output, null, 2));
    process.exit(0);
  } catch {
    process.stdout.write('');
    process.exit(0);
  }
}

function isSafeRelativePath(p: string): boolean {
  const normalized = path.normalize(p);
  if (!normalized || normalized.trim() === '') return false;
  if (path.isAbsolute(normalized)) return false;
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return false;
  return true;
}

function copyPathRecursiveSync(srcPath: string, destPath: string): void {
  const st = fs.lstatSync(srcPath);
  if (st.isSocket?.() || st.isFIFO?.()) return;
  if (st.isSymbolicLink()) {
    const link = fs.readlinkSync(srcPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try {
      fs.unlinkSync(destPath);
    } catch {
      // ignore
    }
    fs.symlinkSync(link, destPath);
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    const entries = fs.readdirSync(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      copyPathRecursiveSync(path.join(srcPath, entry.name), path.join(destPath, entry.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

function copySeedFilesFromProvidedWorkspaceConfig(params: {
  workspaceRoot: string;
  providedWorkspaceConfigPath: string;
  seedFiles: unknown;
}): void {
  const { workspaceRoot, providedWorkspaceConfigPath, seedFiles } = params;
  if (!Array.isArray(seedFiles) || seedFiles.length === 0) return;
  const sourceRoot = path.dirname(providedWorkspaceConfigPath);

  print(`\n${symbols.info} Copying seed files into workspace...`, 'cyan');
  log(`Copying ${seedFiles.length} seed file(s) from ${sourceRoot} into ${workspaceRoot}`);

  for (const entry of seedFiles) {
    if (typeof entry !== 'string') continue;
    const relPath = entry.trim();
    if (!isSafeRelativePath(relPath)) continue;

    const srcPath = path.join(sourceRoot, relPath);
    const destPath = path.join(workspaceRoot, relPath);
    try {
      if (!fs.existsSync(srcPath)) continue;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      copyPathRecursiveSync(srcPath, destPath);
      print(`  ${symbols.success} Copied: ${relPath}`, 'green');
    } catch (e) {
      const err = e as Error;
      print(`  ${symbols.warning} Failed to copy ${relPath}: ${err.message}`, 'yellow');
      log(`Failed to copy seed path ${srcPath} -> ${destPath}: ${err.message}`);
    }
  }
}

async function ensureWorkspaceConfig(): Promise<WorkspaceConfig> {
  if (!fs.existsSync(WORKSPACE_ROOT)) fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

  let config = readJSON(CONFIG_FILE) as WorkspaceConfig | null;
  if (!config) {
    const modules = INSTALL_MODULES ? INSTALL_MODULES.split(',').map((m) => m.trim()) : ['core', 'cursor'];

    // Calculate relative path from workspace to devduck project
    let devduckPath = path.relative(WORKSPACE_ROOT, PROJECT_ROOT);
    if (!devduckPath || devduckPath === '.') devduckPath = './projects/devduck';
    else if (!devduckPath.startsWith('.')) devduckPath = './' + devduckPath;

    config = {
      workspaceVersion: '0.1.0',
      devduckPath,
      modules,
      moduleSettings: {},
      repos: [],
      projects: [],
      checks: [],
      env: []
    } as WorkspaceConfig;

    if (WORKSPACE_CONFIG_PATH && fs.existsSync(WORKSPACE_CONFIG_PATH)) {
      const provided = readJSON(WORKSPACE_CONFIG_PATH) as Record<string, unknown> | null;
      if (provided) {
        config = { ...(config as any), ...(provided as any) };
        const seedFiles = (provided as any).seedFiles ?? (provided as any).files;
        copySeedFilesFromProvidedWorkspaceConfig({
          workspaceRoot: WORKSPACE_ROOT,
          providedWorkspaceConfigPath: WORKSPACE_CONFIG_PATH,
          seedFiles
        });
      }
    }

    if (CONFIG_FILE_PATH && fs.existsSync(CONFIG_FILE_PATH)) {
      const providedConfig = readJSON(CONFIG_FILE_PATH) as Record<string, unknown> | null;
      if (providedConfig) {
        config = { ...(config as any), ...(providedConfig as any) };
      }
    }

    writeJSON(CONFIG_FILE, config);
    print(`\n${symbols.success} Created workspace.config.json`, 'green');
    log(`Created workspace.config.json`);
    return config as WorkspaceConfig;
  }

  // Update existing config if modules specified
  if (INSTALL_MODULES) {
    const modules = INSTALL_MODULES.split(',').map((m) => m.trim());
    (config as any).modules = modules;
    writeJSON(CONFIG_FILE, config);
    print(`\n${symbols.info} Updated workspace.config.json with modules: ${modules.join(', ')}`, 'cyan');
    log(`Updated workspace.config.json with modules`);
  }

  return config as WorkspaceConfig;
}

async function main(): Promise<void> {
  if (STATUS_ONLY) {
    showStatus();
    return;
  }

  initLogging();
  print(`\n${symbols.search} Installing...`, 'blue');

  const config = await ensureWorkspaceConfig();

  // Ensure .env exists and is updated from config before steps run
  await setupEnvFile(WORKSPACE_ROOT, config, { autoYes: !!AUTO_YES, log, print, symbols });

  const { ok } = await runInstallSteps({
    workspaceRoot: WORKSPACE_ROOT,
    config,
    autoYes: !!AUTO_YES,
    log
  });

  log(`\n=== Installer finished at ${new Date().toISOString()} (ok=${ok}) ===\n`);
  if (logStream) {
    await new Promise((resolve) => logStream!.end(resolve));
  }
  process.exit(ok ? 0 : 1);
}

main().catch(async (error) => {
  const err = error as Error;
  print(`\n${symbols.error} Fatal error: ${err.message}`, 'red');
  if (logStream) {
    log(`FATAL ERROR: ${err.message}\n${err.stack}`);
    await new Promise<void>((resolve) => logStream!.end(() => resolve()));
  }
  process.exit(1);
});

