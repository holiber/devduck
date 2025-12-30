#!/usr/bin/env node

/**
 * Test helpers for workspace installer tests
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import http from 'node:http';
import { once } from 'node:events';
import os from 'os';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INSTALLER_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'install.ts');
const WORKSPACE_FIXTURES_ROOT = path.resolve(__dirname, '..', 'workspace-fixtures');
const TSX_BIN = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

type CapturedOutput = { stdout: string; stderr: string };

interface RunInstallerOptions {
  unattended?: boolean;
  config?: string;
  workspaceConfig?: string;
  aiAgent?: string;
  repoType?: string;
  extensions?: string | string[];
  skipRepoInit?: boolean;
  inputs?: string[];
}

interface InstallerResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface VerificationResult {
  workspaceConfigExists: boolean;
  cursorDirExists: boolean;
  commandsDirExists: boolean;
  rulesDirExists: boolean;
  mcpJsonExists: boolean;
  cacheDirExists: boolean;
  cursorignoreExists: boolean;
  errors: string[];
}

interface ConfigVerificationResult {
  valid: boolean;
  config: Record<string, unknown> | null;
  errors: string[];
}

interface ModuleVerificationResult {
  modulesFound: string[];
  modulesMissing: string[];
  commandsFound: number;
  rulesFound: boolean;
  errors: string[];
}

/**
 * Create a temporary directory for testing
 * @returns {Promise<string>} Path to temporary directory
 */
export async function createTempWorkspace(prefix = 'barducks-test-'): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return tmpDir;
}

/**
 * Clean up temporary workspace
 * @param {string} workspacePath - Path to workspace to clean up
 */
export async function cleanupTempWorkspace(workspacePath: string): Promise<void> {
  // Keep this strict: only allow cleanup of our temp test dirs under OS tmpdir.
  // (Do not delete developer paths by accident.)
  const base = path.basename(workspacePath);
  if (!workspacePath || !workspacePath.startsWith(os.tmpdir()) || !base.startsWith('barducks-')) {
    throw new Error('Safety check: Only cleaning up barducks-* temp test directories');
  }
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (error: unknown) {
    // Ignore errors during cleanup
    const err = error as { message?: string };
    console.warn(`Warning: Failed to cleanup ${workspacePath}: ${err.message || String(error)}`);
  }
}

export function getWorkspaceFixturePath(...segments: string[]): string {
  return path.join(WORKSPACE_FIXTURES_ROOT, ...segments);
}

async function copyDirContents(srcDir: string, destDir: string): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    await fs.cp(src, dest, { recursive: true, force: true });
  }
}

/**
 * Create a temp workspace and seed it with a fixture from tests/workspace-fixtures/<fixtureName>.
 *
 * Note: the fixture is copied into a temp dir so tests can freely mutate it.
 */
export async function createWorkspaceFromFixture(
  fixtureName: string,
  options: { prefix?: string } = {}
): Promise<string> {
  const workspaceRoot = await createTempWorkspace(options.prefix);
  const fixtureRoot = getWorkspaceFixturePath(fixtureName);

  // Fail fast if fixture is missing.
  await fs.access(fixtureRoot);
  await copyDirContents(fixtureRoot, workspaceRoot);

  return workspaceRoot;
}

/**
 * Execute installer with given options
 */
export async function runInstaller(workspacePath: string, options: RunInstallerOptions = {}): Promise<InstallerResult> {
  return await new Promise(async (resolve, reject) => {
    const args = ['--workspace-path', workspacePath];
    
    if (options.unattended) {
      args.push('--unattended');
    }
    
    if (options.config) {
      args.push('--config', options.config);
    }

    if (options.workspaceConfig) {
      args.push('--workspace-config', options.workspaceConfig);
    }
    
    if (options.aiAgent) {
      args.push('--ai-agent', options.aiAgent);
    }
    
    if (options.repoType) {
      args.push('--repo-type', options.repoType);
    }
    
    const extensions = options.extensions;
    if (extensions) {
      // Prefer the new flag, keep legacy behavior covered too.
      args.push('--extensions', Array.isArray(extensions) ? extensions.join(',') : extensions);
    }
    
    if (options.skipRepoInit) {
      args.push('--skip-repo-init');
    }

    let stdout = '';
    let stderr = '';
    let inputIndex = 0;
    
    // Installer tests run in CI without user secrets; however some modules (e.g. cursor) require tokens.
    // Provide deterministic dummy values so installer checks don't block unattended installs.
    const needsCursor = await workspaceNeedsCursorModule({
      workspacePath,
      modulesArg: options.extensions,
      configPath: options.config,
      workspaceConfigPath: options.workspaceConfig
    });
    const mockCursorApiBaseUrl = needsCursor ? await getOrStartMockCursorApiBaseUrl() : null;
    const proc = spawn(TSX_BIN, [INSTALLER_SCRIPT, ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ...(needsCursor
          ? {
              CURSOR_API_KEY: process.env.CURSOR_API_KEY || 'test-cursor-api-key',
              // Avoid hitting the real Cursor API in tests; make cursor-api-key-valid deterministic.
              CURSOR_API_BASE_URL: process.env.CURSOR_API_BASE_URL || (mockCursorApiBaseUrl ?? undefined)
            }
          : {})
      }
    });

    // Handle inputs for interactive mode
    if (options.inputs && options.inputs.length > 0) {
      // Writable doesn't have setEncoding; use setDefaultEncoding instead.
      proc.stdin.setDefaultEncoding('utf8');
      
      // Send inputs with delays to simulate user interaction
      const sendInput = () => {
        if (inputIndex < options.inputs!.length) {
          setTimeout(() => {
            proc.stdin.write(options.inputs![inputIndex] + '\n');
            inputIndex++;
            if (inputIndex < options.inputs!.length) {
              sendInput();
            } else {
              proc.stdin.end();
            }
          }, 100);
        }
      };
      
      // Wait a bit before sending first input
      setTimeout(sendInput, 200);
    } else if (options.unattended) {
      proc.stdin.end();
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code
      });
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

function captureOutputWrite<TWrite extends (...args: any[]) => any>(
  original: TWrite,
  onChunk: (chunk: string) => void
): TWrite {
  return ((...args: any[]) => {
    try {
      const first = args[0];
      if (typeof first === 'string') onChunk(first);
      else if (Buffer.isBuffer(first)) onChunk(first.toString('utf8'));
    } catch {
      // ignore
    }
    return original(...args);
  }) as unknown as TWrite;
}

async function captureStdoutStderr<T>(fn: () => Promise<T>): Promise<{ value: T; output: CapturedOutput }> {
  const out: CapturedOutput = { stdout: '', stderr: '' };

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  // Capture but still pass-through so developer logs remain visible when debugging locally.
  (process.stdout as any).write = captureOutputWrite(origStdoutWrite, (c) => {
    out.stdout += c;
  });
  (process.stderr as any).write = captureOutputWrite(origStderrWrite, (c) => {
    out.stderr += c;
  });

  try {
    const value = await fn();
    return { value, output: out };
  } finally {
    (process.stdout as any).write = origStdoutWrite;
    (process.stderr as any).write = origStderrWrite;
  }
}

function withPatchedEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

/**
 * Faster installer runner for tests: runs installer in-process (no tsx child process).
 *
 * Notes:
 * - Still exercises the same install steps as the CLI (via installWorkspace()).
 * - Captures stdout/stderr while preserving pass-through output.
 */
export async function runInstallerInProcess(
  workspacePath: string,
  options: RunInstallerOptions = {}
): Promise<InstallerResult> {
  const projectRoot = PROJECT_ROOT;
  const cacheDir = path.join(workspacePath, '.cache');
  const logFilePath = path.join(cacheDir, 'install.log');
  const projectsDir = path.join(workspacePath, 'projects');
  const configFilePath = path.join(workspacePath, 'workspace.config.yml');
  const envFilePath = path.join(workspacePath, '.env');

  const autoYes = Boolean(options.unattended);
  const extensions = options.extensions;
  const installModules =
    extensions && (Array.isArray(extensions) ? extensions.join(',') : extensions);

  const needsCursor = await workspaceNeedsCursorModule({
    workspacePath,
    modulesArg: options.extensions,
    configPath: options.config,
    workspaceConfigPath: options.workspaceConfig
  });

  // Important: when the cursor module is enabled, tests rely on a mock HTTP server.
  // The installer executes checks via sync child processes; if we run the mock server
  // in the same process, the event loop is blocked and curl can't get a response.
  // Fall back to the subprocess-based runner for cursor-enabled installs.
  if (needsCursor) {
    return await runInstaller(workspacePath, options);
  }

  const mockCursorApiBaseUrl = needsCursor ? await getOrStartMockCursorApiBaseUrl() : null;

  const { installWorkspace } = await import('../../src/install/workspace-install.js');
  const {
    installStep1CheckEnv,
    installStep2DownloadRepos,
    installStep3DownloadProjects,
    installStep4CheckEnvAgain,
    installStep5SetupModules,
    installStep6SetupProjects,
    installStep7VerifyInstallation
  } = await import('../../src/install/index.js');

  const { value: result, output } = await withPatchedEnv(
    {
      NODE_ENV: 'test',
      ...(needsCursor
        ? {
            CURSOR_API_KEY: process.env.CURSOR_API_KEY || 'test-cursor-api-key',
            CURSOR_API_BASE_URL: process.env.CURSOR_API_BASE_URL || (mockCursorApiBaseUrl ?? undefined)
          }
        : {})
    },
    async () =>
      await captureStdoutStderr(async () => {
        // Best-effort: avoid installer prompting in unattended tests, but keep behavior for GUI tests.
        // Most installer tests run with unattended=true; for unattended=false we still allow prompts.
        const logMessages: string[] = [];
        const log = (msg: string) => logMessages.push(msg);

        return await installWorkspace({
          workspaceRoot: workspacePath,
          projectRoot,
          configFilePath,
          envFilePath,
          cacheDir,
          logFilePath,
          projectsDir,
          autoYes,
          installModules,
          workspaceConfigPath: options.workspaceConfig,
          configFilePathOverride: options.config,
          log,
          logger: null,
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
      })
  );

  const status = (result as { status?: string }).status;
  const exitCode = status === 'completed' ? 0 : 1;

  // Some tests assert on CLI-only summary lines. When running in-process, emulate the same
  // "INSTALLATION FINISHED WITH ERRORS" footer the CLI prints on failures.
  if (status === 'failed') {
    try {
      const { loadInstallState } = await import('../../src/install/install-state.js');
      const state = loadInstallState(workspacePath) as { executedChecks?: Array<{ passed: boolean | null }> };
      const executed = Array.isArray(state.executedChecks) ? state.executedChecks : [];
      const total = executed.filter((c) => c.passed !== null).length;
      const passed = executed.filter((c) => c.passed === true).length;

      output.stdout += `\nINSTALLATION FINISHED WITH ERRORS\nChecks: ${passed}/${total} passed\nSee log: .cache/install.log\n`;
    } catch {
      // Best-effort only.
    }
  }

  return {
    stdout: output.stdout,
    stderr: output.stderr,
    exitCode
  };
}

let mockCursorApiServer: http.Server | null = null;
let mockCursorApiBaseUrl: string | null = null;

async function getOrStartMockCursorApiBaseUrl(): Promise<string> {
  if (mockCursorApiBaseUrl) return mockCursorApiBaseUrl;

  mockCursorApiServer = http.createServer((req, res) => {
    // Mimic the endpoint used in modules/cursor/MODULE.md
    if (req.url?.startsWith('/v1/models')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  // Important: do not keep the test runner alive because of this server.
  // We'll allow Node to exit even if the mock server is still listening.
  mockCursorApiServer.unref();

  mockCursorApiServer.listen(0, '127.0.0.1');
  await once(mockCursorApiServer, 'listening');
  const addr = mockCursorApiServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to start mock Cursor API server');
  }
  mockCursorApiBaseUrl = `http://127.0.0.1:${addr.port}`;
  return mockCursorApiBaseUrl;
}

function normalizeModulesList(modules: string | string[] | undefined): string[] | null {
  if (!modules) return null;
  if (Array.isArray(modules)) return modules;
  return modules
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

async function workspaceNeedsCursorModule(params: {
  workspacePath: string;
  modulesArg: string | string[] | undefined;
  configPath: string | undefined;
  workspaceConfigPath: string | undefined;
}): Promise<boolean> {
  const fromArg = normalizeModulesList(params.modulesArg);
  if (fromArg) return fromArg.includes('cursor');

  const readExtensionsFromYamlFile = async (filePath: string): Promise<string[] | null> => {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = YAML.parse(raw) as { extensions?: unknown };
      if (Array.isArray(parsed.extensions)) return parsed.extensions as string[];
      return null;
    } catch {
      return null;
    }
  };

  // If a config file is passed, infer modules from it (common in tests).
  if (params.configPath) {
    const mods = await readExtensionsFromYamlFile(params.configPath);
    if (mods && mods.includes('cursor')) return true;
  }

  // If a workspace-config template is passed, infer modules from it.
  if (params.workspaceConfigPath) {
    const mods = await readExtensionsFromYamlFile(params.workspaceConfigPath);
    if (mods && mods.includes('cursor')) return true;
  }

  // If modules are not passed via args, attempt to infer from an existing workspace config (fixtures).
  const configPath = path.join(params.workspacePath, 'workspace.config.yml');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = YAML.parse(raw) as { extensions?: unknown };
    const mods = Array.isArray(parsed.extensions) ? (parsed.extensions as string[]) : [];
    return mods.includes('cursor');
  } catch {
    return false;
  }
}

/**
 * Verify workspace structure
 */
export async function verifyWorkspaceStructure(workspacePath: string): Promise<VerificationResult> {
  const results: VerificationResult = {
    workspaceConfigExists: false,
    cursorDirExists: false,
    commandsDirExists: false,
    rulesDirExists: false,
    mcpJsonExists: false,
    cacheDirExists: false,
    cursorignoreExists: false,
    errors: []
  };

  try {
    // Check workspace.config.yml
    const configPath = path.join(workspacePath, 'workspace.config.yml');
    try {
      await fs.access(configPath);
      results.workspaceConfigExists = true;
    } catch (e) {
      results.errors.push('workspace.config.yml not found');
    }

    // Check .cursor directory
    const cursorDir = path.join(workspacePath, '.cursor');
    try {
      const stat = await fs.stat(cursorDir);
      if (stat.isDirectory()) {
        results.cursorDirExists = true;
      }
    } catch (e) {
      results.errors.push('.cursor directory not found');
    }

    // Check .cursor/commands
    const commandsDir = path.join(cursorDir, 'commands');
    try {
      await fs.access(commandsDir);
      results.commandsDirExists = true;
    } catch (e) {
      results.errors.push('.cursor/commands directory not found');
    }

    // Check .cursor/rules
    const rulesDir = path.join(cursorDir, 'rules');
    try {
      await fs.access(rulesDir);
      results.rulesDirExists = true;
    } catch (e) {
      results.errors.push('.cursor/rules directory not found');
    }

    // Check .cursor/mcp.json
    const mcpJsonPath = path.join(cursorDir, 'mcp.json');
    try {
      await fs.access(mcpJsonPath);
      results.mcpJsonExists = true;
    } catch (e) {
      results.errors.push('.cursor/mcp.json not found');
    }

    // Check .cache/barducks
    const cacheDir = path.join(workspacePath, '.cache', 'barducks');
    try {
      await fs.access(cacheDir);
      results.cacheDirExists = true;
    } catch (e) {
      results.errors.push('.cache/barducks directory not found');
    }

    // Check .cursorignore
    const cursorignorePath = path.join(workspacePath, '.cursorignore');
    try {
      await fs.access(cursorignorePath);
      results.cursorignoreExists = true;
    } catch (e) {
      results.errors.push('.cursorignore not found');
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    results.errors.push(`Error during verification: ${err.message || String(error)}`);
  }

  return results;
}

/**
 * Verify workspace config content
 */
export async function verifyWorkspaceConfig(workspacePath: string, expectedConfig: Record<string, unknown> = {}): Promise<ConfigVerificationResult> {
  const results: ConfigVerificationResult = {
    valid: false,
    config: null,
    errors: []
  };

  try {
    const configPath = path.join(workspacePath, 'workspace.config.yml');
    const content = await fs.readFile(configPath, 'utf8');
    results.config = YAML.parse(content) as Record<string, unknown>;
    const config = results.config;

    // Verify required fields
    if (!config.version) {
      results.errors.push('version missing');
    }
    const extensions = config.extensions as unknown;
    if (!extensions || !Array.isArray(extensions)) {
      results.errors.push('extensions missing or invalid');
    }

    // Verify expected values
    const expectedExtensions = expectedConfig.extensions as unknown;
    if (Array.isArray(expectedExtensions)) {
      const actual = (config.extensions || []) as string[];
      const missing = (expectedExtensions as string[]).filter(m => !actual.includes(m));
      if (missing.length > 0) {
        results.errors.push(`Missing extensions: ${missing.join(', ')}`);
      }
    }

    if (expectedConfig.barducks_path && config.barducks_path !== expectedConfig.barducks_path) {
      results.errors.push(`barducks_path mismatch: expected ${expectedConfig.barducks_path}, got ${config.barducks_path}`);
    }

    results.valid = results.errors.length === 0;
  } catch (error: unknown) {
    const err = error as { message?: string };
    results.errors.push(`Error reading config: ${err.message || String(error)}`);
  }

  return results;
}

/**
 * Verify module installation
 */
export async function verifyModuleInstallation(workspacePath: string, expectedModules: string[] = []): Promise<ModuleVerificationResult> {
  const results: ModuleVerificationResult = {
    modulesFound: [],
    modulesMissing: [],
    commandsFound: 0,
    rulesFound: false,
    errors: []
  };

  try {
    // Check commands directory
    const commandsDir = path.join(workspacePath, '.cursor', 'commands');
    try {
      const files = await fs.readdir(commandsDir);
      results.commandsFound = files.length;
    } catch (e) {
      results.errors.push('Cannot read commands directory');
    }

    // Check rules file
    const rulesPath = path.join(workspacePath, '.cursor', 'rules', 'barducks-rules.md');
    try {
      await fs.access(rulesPath);
      results.rulesFound = true;
    } catch (e) {
      results.errors.push('barducks-rules.md not found');
    }

    // Check MCP config
    const mcpPath = path.join(workspacePath, '.cursor', 'mcp.json');
    try {
      const mcpContent = await fs.readFile(mcpPath, 'utf8');
      const mcpConfig = JSON.parse(mcpContent) as { mcpServers?: Record<string, unknown> };
      if (mcpConfig.mcpServers) {
        results.modulesFound = Object.keys(mcpConfig.mcpServers);
      }
    } catch (e) {
      results.errors.push('Cannot read mcp.json');
    }

    // Check which expected modules are missing
    if (expectedModules.length > 0) {
      results.modulesMissing = expectedModules.filter(m => !results.modulesFound.includes(m));
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    results.errors.push(`Error during module verification: ${err.message || String(error)}`);
  }

  return results;
}

/**
 * Wait for installation to complete
 */
export async function waitForInstallation(workspacePath: string, timeout = 30000, checkInterval = 100): Promise<boolean> {
  const startTime = Date.now();
  const configPath = path.join(workspacePath, 'workspace.config.yml');
  const cacheDir = path.join(workspacePath, '.cache', 'barducks');

  while (Date.now() - startTime < timeout) {
    try {
      await fs.access(configPath);
      await fs.access(cacheDir);
      return true;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  return false;
}

/**
 * Create a mock workspace config for existing workspace tests
 */
export async function createMockWorkspace(workspacePath: string, config: Record<string, unknown> = {}): Promise<void> {
  const defaultConfig = {
    version: '0.1.0',
    barducks_path: './barducks',
    extensions: ['core', 'cursor'],
    extensionSettings: {}
  };

  const finalConfig = { ...defaultConfig, ...config };
  const configPath = path.join(workspacePath, 'workspace.config.yml');
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(configPath, YAML.stringify(finalConfig), 'utf8');
}

/**
 * Check if installer result indicates failure and throw early
 */
export function checkInstallerResult(result: InstallerResult): void {
  if (result.exitCode !== 0) {
    const errorMsg = result.stderr || result.stdout || 'Unknown error';
    throw new Error(`Installer failed with exit code ${result.exitCode}. Error: ${errorMsg}`);
  }
}

/**
 * Create a shared temporary workspace in .cache/temp directory
 * @param prefix - Prefix for the workspace directory name
 * @returns Path to the created workspace
 */
export async function createSharedTempWorkspace(prefix = 'install-steps-test-'): Promise<string> {
  const cacheTempDir = path.join(PROJECT_ROOT, '.cache', 'temp');
  await fs.mkdir(cacheTempDir, { recursive: true });
  
  const workspaceName = prefix + Date.now();
  const workspacePath = path.join(cacheTempDir, workspaceName);
  await fs.mkdir(workspacePath, { recursive: true });
  
  return workspacePath;
}

/**
 * Clean up shared temporary workspace
 * @param workspacePath - Path to workspace to clean up
 */
export async function cleanupSharedTempWorkspace(workspacePath: string): Promise<void> {
  // Safety check: only clean .cache/temp/ directories
  const cacheTempDir = path.join(PROJECT_ROOT, '.cache', 'temp');
  const normalizedPath = path.resolve(workspacePath);
  const normalizedCacheTemp = path.resolve(cacheTempDir);
  
  if (!normalizedPath.startsWith(normalizedCacheTemp)) {
    throw new Error('Safety check: Only cleaning up .cache/temp/ directories');
  }
  
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (error: unknown) {
    // Ignore errors during cleanup
    const err = error as { message?: string };
    console.warn(`Warning: Failed to cleanup ${workspacePath}: ${err.message || String(error)}`);
  }
}

/**
 * Check if a step is completed in install-state.json
 * @param workspaceRoot - Workspace root directory
 * @param stepName - Name of the step to check
 * @returns True if step is completed successfully
 */
export async function isStepCompleted(workspaceRoot: string, stepName: string): Promise<boolean> {
  const { loadInstallState } = await import('../../src/install/install-state.js');
  const state = loadInstallState(workspaceRoot);
  
  const stepKey = stepName as keyof typeof state.steps;
  return state.steps[stepKey]?.completed === true;
}

/**
 * Get step result from install-state.json
 * @param workspaceRoot - Workspace root directory
 * @param stepName - Name of the step
 * @returns Step result or null if step not completed
 */
export async function getStepResult(workspaceRoot: string, stepName: string): Promise<unknown> {
  const { loadInstallState } = await import('../../src/install/install-state.js');
  const state = loadInstallState(workspaceRoot);
  
  const stepKey = stepName as keyof typeof state.steps;
  return state.steps[stepKey]?.result || null;
}

/**
 * Get list of executed checks from install-state.json
 * @param workspaceRoot - Workspace root directory
 * @returns Array of executed checks
 */
export async function getExecutedChecks(workspaceRoot: string): Promise<Array<{checkId: string; step: string; passed: boolean | null; executedAt: string; checkName?: string}>> {
  const { loadInstallState } = await import('../../src/install/install-state.js');
  const state = loadInstallState(workspaceRoot);
  
  return state.executedChecks || [];
}

/**
 * Verify step state matches expected status
 * @param workspaceRoot - Workspace root directory
 * @param stepName - Name of the step
 * @param expectedStatus - Expected status ('completed' or 'failed')
 * @returns True if state matches expected status
 */
export async function verifyStepState(
  workspaceRoot: string,
  stepName: string,
  expectedStatus: 'completed' | 'failed'
): Promise<boolean> {
  const { loadInstallState } = await import('../../src/install/install-state.js');
  const state = loadInstallState(workspaceRoot);
  
  const stepKey = stepName as keyof typeof state.steps;
  const step = state.steps[stepKey];
  
  if (expectedStatus === 'completed') {
    return step?.completed === true && !step.error;
  } else {
    return step?.completed === true && !!step.error;
  }
}

