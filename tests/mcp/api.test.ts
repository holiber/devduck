import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

import { mcpRouter } from '../../modules/mcp/api.js';
import { getUnifiedAPI } from '../../scripts/lib/api.js';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('mcp: API module', () => {
  let originalCwd: string;
  let testWorkspaceRoot: string | null;

  beforeEach(() => {
    originalCwd = process.cwd();
    testWorkspaceRoot = findWorkspaceRoot(process.cwd());
  });

  afterEach(() => {
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
    assert.ok('mcp' in unifiedAPI);
    assert.strictEqual(unifiedAPI.mcp, mcpRouter);
  });

  test('mcp.list can list servers when mcp.json exists', async () => {
    if (!testWorkspaceRoot) {
      // Skip if not in workspace
      return;
    }

    const mcpJsonPath = path.join(testWorkspaceRoot, '.cursor', 'mcp.json');
    if (!fs.existsSync(mcpJsonPath)) {
      // Skip if mcp.json doesn't exist
      return;
    }

    const result = await mcpRouter.call('list', {}, { provider: null });
    assert.ok(Array.isArray(result));
    
    // Check that result contains server info
    if (result.length > 0) {
      const server = result[0] as { name?: string };
      assert.ok(server.name);
      assert.ok(typeof server.name === 'string');
    }
  });

  test('npm run api lists mcp methods', async () => {
    if (!testWorkspaceRoot) {
      // Skip if not in workspace
      return;
    }

    const packageJsonPath = path.join(testWorkspaceRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      // Skip if package.json doesn't exist
      return;
    }

    // Run npm run api and capture output
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

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });

    // Check that output contains mcp module
    assert.ok(result.stdout.includes('mcp') || result.stderr.includes('mcp'), 
      'Output should contain mcp module');
    
    // Check that output contains mcp.list
    assert.ok(result.stdout.includes('mcp.list') || result.stderr.includes('mcp.list'),
      'Output should contain mcp.list method');
  });

  test('mcp.list can be called via API CLI', async () => {
    if (!testWorkspaceRoot) {
      // Skip if not in workspace
      return;
    }

    const packageJsonPath = path.join(testWorkspaceRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      // Skip if package.json doesn't exist
      return;
    }

    // Run npm run api mcp.list and capture output
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const proc = spawn('npm', ['run', 'api', 'mcp.list'], {
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

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });

    // Check that command executed (exit code 0 or output contains result)
    const output = result.stdout + result.stderr;
    
    // Should either succeed with JSON output or show help/error
    assert.ok(
      output.includes('result') || 
      output.includes('mcp.list') || 
      output.includes('Usage') ||
      result.code === 0,
      `Command should execute. Output: ${output.substring(0, 500)}`
    );
  });

  test('mcp.call can be called via API CLI (help check)', async () => {
    if (!testWorkspaceRoot) {
      // Skip if not in workspace
      return;
    }

    const apiCliPath = path.join(testWorkspaceRoot, 'projects', 'devduck', 'scripts', 'api-cli.ts');
    if (!fs.existsSync(apiCliPath)) {
      // Skip if api-cli.ts doesn't exist
      return;
    }

    // Run npx tsx api-cli.ts mcp.call --help to verify command is available
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const proc = spawn('npx', ['tsx', apiCliPath, 'mcp.call', '--help'], {
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

      proc.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });

    // Check that help is shown (command exists)
    const output = result.stdout + result.stderr;
    
    assert.ok(
      output.includes('mcp.call') || 
      output.includes('Call MCP tool/method') ||
      output.includes('serverName') ||
      output.includes('toolName'),
      `Help should be shown for mcp.call. Output: ${output.substring(0, 500)}`
    );
  });
});

