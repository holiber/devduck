#!/usr/bin/env node

/**
 * Launch module API - orchestrate workspace "launch" scenarios.
 *
 * Intended usage:
 *   npm run api launch.dev
 *
 * Reads workspace.config.json:
 *   launch: { dev: [ ...checks ] }
 */

import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { setTimeout as sleep } from 'timers/promises';
import { spawn, type ChildProcess } from 'child_process';

import { initProviderContract } from '../../scripts/lib/provider-router.js';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';
import { readJSON } from '../../scripts/lib/config.js';

type UnknownRecord = Record<string, unknown>;

type WorkspaceConfigLike = {
  launch?: {
    dev?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

const LaunchStartCheckSchema = z
  .object({
    name: z.string(),
    type: z.literal('start'),
    project: z.string().min(1),
    command: z.string().min(1),
    readyUrl: z.string().optional(),
    readyText: z.string().optional(),
    env: z.record(z.string()).optional(),
  })
  .passthrough();

const LaunchHttpCheckSchema = z
  .object({
    name: z.string(),
    type: z.literal('http'),
    url: z.string().url(),
    expectText: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .passthrough();

const LaunchPlaywrightCheckSchema = z
  .object({
    name: z.string(),
    type: z.literal('playwright'),
    project: z.string().min(1),
    command: z.string().min(1),
    env: z.record(z.string()).optional(),
  })
  .passthrough();

const LaunchCheckSchema = z.discriminatedUnion('type', [
  LaunchStartCheckSchema,
  LaunchHttpCheckSchema,
  LaunchPlaywrightCheckSchema,
]);

const LaunchConfigSchema = z.object({
  dev: z.array(LaunchCheckSchema).default([]),
});

function getProjectPath(workspaceRoot: string, projectName: string): string {
  // Prefer the installed/symlinked projects/ directory (what the installer creates).
  const p = path.join(workspaceRoot, 'projects', projectName);
  if (fs.existsSync(p)) return p;
  // Fallback: allow using the workspace src/<projectName> layout directly.
  return path.join(workspaceRoot, 'src', projectName);
}

function hasNvm(): boolean {
  const home = process.env.HOME || '';
  if (!home) return false;
  return fs.existsSync(path.join(home, '.nvm', 'nvm.sh'));
}

function wrapWithNvmBash(command: string): string {
  // Use latest LTS if available; keep it best-effort.
  // This is intentionally defensive: if nvm is not present, callers should run without it.
  return [
    'set -euo pipefail',
    'source ~/.nvm/nvm.sh',
    // Use "node" alias (latest stable) if present, else fallback to --lts
    '(nvm use node >/dev/null 2>&1 || (nvm install --lts --no-progress >/dev/null 2>&1 && nvm use --lts >/dev/null 2>&1) || true)',
    command,
  ].join(' && ');
}

function spawnDetachedProcess(params: {
  cwd: string;
  command: string;
  env?: Record<string, string>;
}): ChildProcess {
  const finalEnv = { ...process.env, ...(params.env || {}) };
  const cmd = hasNvm() ? wrapWithNvmBash(params.command) : params.command;

  // We spawn via bash -lc to keep "npm run ..." semantics and PATH resolution consistent.
  const child = spawn('bash', ['-lc', cmd], {
    cwd: params.cwd,
    env: finalEnv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return child;
}

async function waitForHttp(params: {
  url: string;
  timeoutMs: number;
  expectText?: string;
}): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + params.timeoutMs;
  let lastErr: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(params.url, { method: 'GET' });
      const body = await res.text();
      if (res.status >= 200 && res.status < 500) {
        if (params.expectText && !body.includes(params.expectText)) {
          lastErr = `Response did not include expected text: ${JSON.stringify(params.expectText)}`;
        } else {
          return { status: res.status, body };
        }
      } else {
        lastErr = `HTTP ${res.status}`;
      }
    } catch (e) {
      lastErr = (e as Error).message || String(e);
    }

    if (Date.now() > deadline) {
      throw new Error(`Timeout waiting for ${params.url}${lastErr ? ` (${lastErr})` : ''}`);
    }
    await sleep(200);
  }
}

async function runCommandForeground(params: {
  cwd: string;
  command: string;
  env?: Record<string, string>;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const finalEnv = { ...process.env, ...(params.env || {}) };
  const cmd = hasNvm() ? wrapWithNvmBash(params.command) : params.command;

  return await new Promise((resolve) => {
    const child = spawn('bash', ['-lc', cmd], {
      cwd: params.cwd,
      env: finalEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function terminateProcessTree(child: ChildProcess, graceMs = 5_000): Promise<void> {
  if (!child.pid) return;

  try {
    // If detached: kill the whole process group.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return;
    await sleep(100);
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

const t = initProviderContract<unknown>();

export const launchRouter = t.router({
  dev: t.procedure
    .input(
      z
        .object({
          // Optional override: run with a different base URL for client readiness check
          clientReadyUrl: z.string().url().optional(),
        })
        .optional()
        .default({})
    )
    .output(
      z.object({
        ok: z.boolean(),
        steps: z.array(
          z.object({
            name: z.string(),
            type: z.string(),
            ok: z.boolean(),
            note: z.string().optional(),
          })
        ),
      })
    )
    .meta({
      title: 'Launch dev scenario',
      description:
        'Start workspace projects, verify server API, run client Playwright e2e with screenshots, then clean up.',
      idempotent: false,
      timeoutMs: 15 * 60_000,
    })
    .handler(async ({ input }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      if (!workspaceRoot) {
        throw new Error('Workspace root not found (missing workspace.config.json?)');
      }

      const cfgPath = path.join(workspaceRoot, 'workspace.config.json');
      const cfg = readJSON<WorkspaceConfigLike>(cfgPath) || ({} as WorkspaceConfigLike);

      const launchRaw = (cfg.launch || {}) as UnknownRecord;
      const parsed = LaunchConfigSchema.safeParse({ dev: launchRaw.dev });
      if (!parsed.success) {
        throw new Error(
          `Invalid launch.dev configuration in workspace.config.json: ${parsed.error.message}`
        );
      }

      const checks = parsed.data.dev;
      if (checks.length === 0) {
        throw new Error('No launch.dev checks configured (workspace.config.json launch.dev is empty)');
      }

      const steps: Array<{ name: string; type: string; ok: boolean; note?: string }> = [];
      const running: ChildProcess[] = [];

      const clientReadyUrl = input.clientReadyUrl || 'http://localhost:3000';

      try {
        for (const check of checks) {
          if (check.type === 'start') {
            const projectPath = getProjectPath(workspaceRoot, check.project);
            const child = spawnDetachedProcess({
              cwd: projectPath,
              command: check.command,
              env: check.env,
            });
            running.push(child);

            if (check.readyUrl) {
              const readyUrl =
                check.project === 'client' && check.readyUrl === 'AUTO'
                  ? clientReadyUrl
                  : check.readyUrl;
              await waitForHttp({
                url: readyUrl,
                timeoutMs: 60_000,
                expectText: check.readyText,
              });
            }

            steps.push({ name: check.name, type: check.type, ok: true });
            continue;
          }

          if (check.type === 'http') {
            await waitForHttp({
              url: check.url,
              timeoutMs: check.timeoutMs || 20_000,
              expectText: check.expectText,
            });
            steps.push({ name: check.name, type: check.type, ok: true });
            continue;
          }

          if (check.type === 'playwright') {
            const projectPath = getProjectPath(workspaceRoot, check.project);
            const result = await runCommandForeground({
              cwd: projectPath,
              command: check.command,
              env: {
                ...(check.env || {}),
                BASE_URL: clientReadyUrl,
              },
            });

            if (result.code !== 0) {
              throw new Error(
                `Playwright check failed (${check.name}). Exit code ${result.code}\n` +
                  `STDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`
              );
            }

            steps.push({ name: check.name, type: check.type, ok: true });
            continue;
          }

          // Should be unreachable due to discriminated union
          steps.push({ name: (check as any).name || 'unknown', type: (check as any).type || 'unknown', ok: false });
          throw new Error(`Unsupported launch check type: ${(check as any).type}`);
        }

        return { ok: true, steps };
      } finally {
        // Always cleanup background processes.
        for (const child of running.reverse()) {
          await terminateProcessTree(child);
        }
      }
    }),
});

