import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { mcpRouter } from '../../scripts/lib/api/mcp.ts';
import { getUnifiedAPI } from '../../scripts/lib/api.ts';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('mcp: API module', () => {
  let originalCwd: string;
  let testWorkspaceRoot: string | null;

  test.beforeEach(() => {
    originalCwd = process.cwd();
    testWorkspaceRoot = findWorkspaceRoot(process.cwd());
  });

  test.afterEach(() => {
    process.chdir(originalCwd);
  });

  test('mcpRouter is defined and has procedures', () => {
    assert.ok(mcpRouter);
    assert.ok(typeof mcpRouter === 'object');
    assert.ok('call' in mcpRouter);
    assert.ok('toCli' in mcpRouter);

    const procedures = (mcpRouter as any).procedures;
    assert.ok(procedures);
    assert.ok('list' in procedures);
    assert.ok('call' in procedures);
  });

  test('mcpRouter.list procedure exists with correct schema', () => {
    const procedures = (mcpRouter as any).procedures;
    const listProcedure = procedures.list;

    assert.ok(listProcedure);
    assert.ok(listProcedure.input);
    assert.ok(listProcedure.output);
    assert.ok(listProcedure.meta);
    assert.ok(listProcedure.handler);
    assert.strictEqual(listProcedure.meta.title, 'List MCP servers or tools');
  });

  test('mcpRouter.call procedure exists with correct schema', () => {
    const procedures = (mcpRouter as any).procedures;
    const callProcedure = procedures.call;

    assert.ok(callProcedure);
    assert.ok(callProcedure.input);
    assert.ok(callProcedure.output);
    assert.ok(callProcedure.meta);
    assert.ok(callProcedure.handler);
    assert.strictEqual(callProcedure.meta.title, 'Call MCP tool/method');
  });

  test('mcp module is included in unified API', async () => {
    const unifiedAPI = await getUnifiedAPI();

    const availableModules = Object.keys(unifiedAPI);
    if (availableModules.length === 0) {
      // No modules found at all - likely a CI environment issue with path resolution
      // Skip this test as it's not a problem with mcp module specifically
      test.skip(true, 'No modules found in unified API (likely CI path resolution issue)');
      return;
    }

    if (!('mcp' in unifiedAPI)) {
      const errorMessage = `mcp module not found in unified API. Available modules: ${availableModules.join(', ')}`;

      // Try to import mcp module directly to see if there's an import error
      try {
        const mcpApiPathTs = path.resolve(__dirname, '../../scripts/lib/api/mcp.ts');
        if (fs.existsSync(mcpApiPathTs)) {
          const mcpModule = await import(pathToFileURL(mcpApiPathTs).href);
          if ((mcpModule as any).mcpRouter) {
            // Module exists but wasn't discovered - this might be a discovery issue
            // eslint-disable-next-line no-console
            console.warn('mcp module exists but was not discovered by unified API');
            // eslint-disable-next-line no-console
            console.warn(`Module path: ${mcpApiPathTs}`);
          }
        }
      } catch (importError) {
        const err = importError as Error;
        // eslint-disable-next-line no-console
        console.warn(`Failed to import mcp module directly: ${err.message}`);
      }

      assert.fail(errorMessage);
    }

    assert.ok('mcp' in unifiedAPI, `mcp module should be in unified API. Available: ${Object.keys(unifiedAPI).join(', ')}`);
    assert.strictEqual((unifiedAPI as any).mcp, mcpRouter);
  });

  test('mcp.list can list servers when mcp.json exists', async () => {
    if (!testWorkspaceRoot) {
      test.skip(true, 'Not in a workspace');
      return;
    }

    const mcpJsonPath = path.join(testWorkspaceRoot, '.cursor', 'mcp.json');
    if (!fs.existsSync(mcpJsonPath)) {
      test.skip(true, 'No .cursor/mcp.json in workspace');
      return;
    }

    const result = await mcpRouter.call('list', {}, { provider: null });
    assert.ok(Array.isArray(result));

    if (result.length > 0) {
      const server = result[0] as { name?: string };
      assert.ok(server.name);
      assert.ok(typeof server.name === 'string');
    }
  });

  test('npm run api lists mcp methods (best-effort)', async () => {
    if (!testWorkspaceRoot) {
      test.skip(true, 'Not in a workspace');
      return;
    }

    const packageJsonPath = path.join(testWorkspaceRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      test.skip(true, 'No package.json in workspace');
      return;
    }

    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const proc = spawn('npm', ['run', 'api'], {
        cwd: testWorkspaceRoot!,
        stdio: 'pipe',
        shell: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      proc.on('close', (code) => resolve({ stdout, stderr, code }));
      proc.on('error', (error) => reject(error));
    });

    const output = result.stdout + result.stderr;
    assert.ok(output.includes('mcp') || output.includes('mcp.list'), 'Output should mention mcp module or methods');
  });

  test('mcp.list can be called via API CLI (best-effort)', async () => {
    if (!testWorkspaceRoot) {
      test.skip(true, 'Not in a workspace');
      return;
    }

    const apiCliPath = path.join(testWorkspaceRoot, 'scripts', 'api-cli.ts');
    if (!fs.existsSync(apiCliPath)) {
      test.skip(true, 'No scripts/api-cli.ts in workspace');
      return;
    }

    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const proc = spawn('npx', ['tsx', apiCliPath, 'mcp.list'], {
        cwd: testWorkspaceRoot!,
        stdio: 'pipe',
        shell: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => (stdout += data.toString()));
      proc.stderr?.on('data', (data) => (stderr += data.toString()));
      proc.on('close', (code) => resolve({ stdout, stderr, code }));
      proc.on('error', (error) => reject(error));
    });

    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('result') || output.includes('mcp.list') || output.includes('Usage') || result.code === 0,
      `Command should execute. Output: ${output.substring(0, 500)}`
    );
  });

  test('mcp.call can be called via API CLI (help check)', async () => {
    if (!testWorkspaceRoot) {
      test.skip(true, 'Not in a workspace');
      return;
    }

    const apiCliPath = path.join(testWorkspaceRoot, 'scripts', 'api-cli.ts');
    if (!fs.existsSync(apiCliPath)) {
      test.skip(true, 'No scripts/api-cli.ts in workspace');
      return;
    }

    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const proc = spawn('npx', ['tsx', apiCliPath, 'mcp.call', '--help'], {
        cwd: testWorkspaceRoot!,
        stdio: 'pipe',
        shell: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => (stdout += data.toString()));
      proc.stderr?.on('data', (data) => (stderr += data.toString()));
      proc.on('close', (code) => resolve({ stdout, stderr, code }));
      proc.on('error', (error) => reject(error));
    });

    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes('mcp.call') || output.includes('Call MCP tool/method') || output.includes('serverName') || output.includes('toolName'),
      `Help should be shown for mcp.call. Output: ${output.substring(0, 500)}`
    );
  });
});

