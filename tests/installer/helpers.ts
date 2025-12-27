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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INSTALLER_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'install.ts');
const WORKSPACE_FIXTURES_ROOT = path.resolve(__dirname, '..', 'workspace-fixtures');

interface RunInstallerOptions {
  unattended?: boolean;
  config?: string;
  workspaceConfig?: string;
  aiAgent?: string;
  repoType?: string;
  modules?: string | string[];
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
export async function createTempWorkspace(prefix = 'devduck-test-'): Promise<string> {
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
  if (!workspacePath || !workspacePath.startsWith(os.tmpdir()) || !base.startsWith('devduck-')) {
    throw new Error('Safety check: Only cleaning up devduck-* temp test directories');
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
    
    if (options.modules) {
      args.push('--modules', Array.isArray(options.modules) ? options.modules.join(',') : options.modules);
    }
    
    if (options.skipRepoInit) {
      args.push('--skip-repo-init');
    }

    let stdout = '';
    let stderr = '';
    let inputIndex = 0;
    
    // Installer tests run in CI without user secrets; however some modules (e.g. cursor) require tokens.
    // Provide deterministic dummy values so pre-install checks don't block unattended installs.
    const mockCursorApiBaseUrl = await getOrStartMockCursorApiBaseUrl();
    const proc = spawn('tsx', [INSTALLER_SCRIPT, ...args], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CURSOR_API_KEY: process.env.CURSOR_API_KEY || 'test-cursor-api-key',
        // Avoid hitting the real Cursor API in tests; make cursor-api-key-valid deterministic.
        CURSOR_API_BASE_URL: process.env.CURSOR_API_BASE_URL || mockCursorApiBaseUrl
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
    // Check workspace.config.json
    const configPath = path.join(workspacePath, 'workspace.config.json');
    try {
      await fs.access(configPath);
      results.workspaceConfigExists = true;
    } catch (e) {
      results.errors.push('workspace.config.json not found');
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

    // Check .cache/devduck
    const cacheDir = path.join(workspacePath, '.cache', 'devduck');
    try {
      await fs.access(cacheDir);
      results.cacheDirExists = true;
    } catch (e) {
      results.errors.push('.cache/devduck directory not found');
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
 * Verify workspace.config.json content
 */
export async function verifyWorkspaceConfig(workspacePath: string, expectedConfig: Record<string, unknown> = {}): Promise<ConfigVerificationResult> {
  const results: ConfigVerificationResult = {
    valid: false,
    config: null,
    errors: []
  };

  try {
    const configPath = path.join(workspacePath, 'workspace.config.json');
    const content = await fs.readFile(configPath, 'utf8');
    results.config = JSON.parse(content) as Record<string, unknown>;
    const config = results.config;

    // Verify required fields
    if (!config.workspaceVersion) {
      results.errors.push('workspaceVersion missing');
    }
    if (!config.modules || !Array.isArray(config.modules)) {
      results.errors.push('modules missing or invalid');
    }

    // Verify expected values
    if (expectedConfig.modules) {
      const actualModules = (config.modules || []) as string[];
      const expectedModules = expectedConfig.modules as string[];
      const missing = expectedModules.filter(m => !actualModules.includes(m));
      if (missing.length > 0) {
        results.errors.push(`Missing modules: ${missing.join(', ')}`);
      }
    }

    if (expectedConfig.devduckPath && config.devduckPath !== expectedConfig.devduckPath) {
      results.errors.push(`devduckPath mismatch: expected ${expectedConfig.devduckPath}, got ${config.devduckPath}`);
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
    const rulesPath = path.join(workspacePath, '.cursor', 'rules', 'devduck-rules.md');
    try {
      await fs.access(rulesPath);
      results.rulesFound = true;
    } catch (e) {
      results.errors.push('devduck-rules.md not found');
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
  const configPath = path.join(workspacePath, 'workspace.config.json');
  const cacheDir = path.join(workspacePath, '.cache', 'devduck');

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
 * Create a mock workspace.config.json for existing workspace tests
 */
export async function createMockWorkspace(workspacePath: string, config: Record<string, unknown> = {}): Promise<void> {
  const defaultConfig = {
    workspaceVersion: '0.1.0',
    devduckPath: './devduck',
    modules: ['core', 'cursor'],
    moduleSettings: {}
  };

  const finalConfig = { ...defaultConfig, ...config };
  const configPath = path.join(workspacePath, 'workspace.config.json');
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(finalConfig, null, 2), 'utf8');
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
  const { loadInstallState } = await import('../../scripts/install/install-state.js');
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
  const { loadInstallState } = await import('../../scripts/install/install-state.js');
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
  const { loadInstallState } = await import('../../scripts/install/install-state.js');
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
  const { loadInstallState } = await import('../../scripts/install/install-state.js');
  const state = loadInstallState(workspaceRoot);
  
  const stepKey = stepName as keyof typeof state.steps;
  const step = state.steps[stepKey];
  
  if (expectedStatus === 'completed') {
    return step?.completed === true && !step.error;
  } else {
    return step?.completed === true && !!step.error;
  }
}

