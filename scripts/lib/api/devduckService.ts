#!/usr/bin/env node

/**
 * DevduckService API - Unified API entry for a non-module service.
 *
 * This is intentionally not a module under modules/*.
 * It exposes a stable API for process supervision via DevduckService IPC.
 */

import { z } from 'zod';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { initProviderContract } from '../provider-router.js';
import { getDevduckServicePaths } from '../../devduck-service/src/paths.js';
import { createDevduckServiceClient } from '../../devduck-service/src/ipc/ipc-client.js';

interface DevduckServiceProvider {
  ping(): Promise<{ ok: true; socketPath: string }>;
}

const t = initProviderContract<DevduckServiceProvider>();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function canConnect(socketPath: string): Promise<boolean> {
  return await new Promise(resolve => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function ensureServiceRunning(socketPath: string): Promise<void> {
  if (await canConnect(socketPath)) return;

  // Start service in the background (singleton lock is handled by the service itself).
  const serviceEntry = path.resolve(__dirname, '../../devduck-service/src/service.ts');

  // Best-effort logs (use the same logs dir as the service).
  const paths = getDevduckServicePaths(process.cwd());
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const outLogPath = path.join(paths.logsDir, 'service.out.log');
  const errLogPath = path.join(paths.logsDir, 'service.err.log');

  let outFd: number | undefined;
  let errFd: number | undefined;
  try {
    outFd = fs.openSync(outLogPath, 'a');
    errFd = fs.openSync(errLogPath, 'a');

    const child = spawn('npx', ['tsx', serviceEntry], {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: { ...process.env }
    });
    child.unref();
  } finally {
    if (typeof outFd === 'number') fs.closeSync(outFd);
    if (typeof errFd === 'number') fs.closeSync(errFd);
  }

  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (await canConnect(socketPath)) return;
    await sleep(50);
  }

  throw new Error(
    `Failed to start DevduckService (socket: ${socketPath}). ` +
      `See logs: ${outLogPath} ${errLogPath}`
  );
}

const ProcessStartInputSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  // Keep args/env as strings to work with auto-generated CLI (yargs).
  // We parse JSON in the handler to avoid ZodEffects (which breaks CLI schema introspection).
  args: z.string().optional().default('[]'),
  cwd: z.string().optional(),
  env: z.string().optional().default('{}')
});

const ProcessStopInputSchema = z.object({
  name: z.string().min(1),
  timeoutMs: z.number().int().positive().optional()
});

export const devduckServiceRouter = t.router({
  ping: t.procedure
    .input(z.object({}))
    .output(z.object({ ok: z.literal(true), socketPath: z.string().min(1), pid: z.number().int().positive() }))
    .meta({
      title: 'Ping DevduckService',
      description: 'Ensure DevduckService is running and reachable via IPC.',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async () => {
      const paths = getDevduckServicePaths(process.cwd());
      await ensureServiceRunning(paths.socketPath);
      const client = createDevduckServiceClient({ socketPath: paths.socketPath });
      const res = await client.ping.query();
      return { ok: true, socketPath: paths.socketPath, pid: res.pid };
    }),

  processStart: t.procedure
    .input(ProcessStartInputSchema)
    .output(z.any())
    .meta({
      title: 'Start a named process',
      description: 'Start a named background process managed by DevduckService ProcessManager.',
      idempotent: false,
      timeoutMs: 15_000
    })
    .handler(async ({ input }) => {
      let args: string[] = [];
      let env: Record<string, string> = {};
      try {
        const parsed = JSON.parse(input.args || '[]') as unknown;
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
          args = parsed;
        } else {
          throw new Error('args must be a JSON array of strings');
        }
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        throw new Error(`Invalid args JSON: ${msg}`);
      }

      try {
        const parsed = JSON.parse(input.env || '{}') as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const rec = parsed as Record<string, unknown>;
          for (const [k, v] of Object.entries(rec)) {
            if (typeof v !== 'string') throw new Error(`env["${k}"] must be a string`);
          }
          env = rec as Record<string, string>;
        } else {
          throw new Error('env must be a JSON object of string values');
        }
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        throw new Error(`Invalid env JSON: ${msg}`);
      }

      const paths = getDevduckServicePaths(process.cwd());
      await ensureServiceRunning(paths.socketPath);
      const client = createDevduckServiceClient({ socketPath: paths.socketPath });
      return await client.process.start.mutate({
        name: input.name,
        command: input.command,
        args,
        cwd: input.cwd ? path.resolve(process.cwd(), input.cwd) : undefined,
        env
      });
    }),

  processStop: t.procedure
    .input(ProcessStopInputSchema)
    .output(z.object({ stopped: z.boolean() }))
    .meta({
      title: 'Stop a named process',
      description: 'Stop a process by name (best-effort kill of the whole process group).',
      idempotent: false,
      timeoutMs: 15_000
    })
    .handler(async ({ input }) => {
      const paths = getDevduckServicePaths(process.cwd());
      await ensureServiceRunning(paths.socketPath);
      const client = createDevduckServiceClient({ socketPath: paths.socketPath });
      return await client.process.stop.mutate({ name: input.name, timeoutMs: input.timeoutMs });
    }),

  processStatus: t.procedure
    .input(z.object({}))
    .output(z.any())
    .meta({
      title: 'Get process status',
      description: 'Return ProcessManager status (running flag for each process).',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async () => {
      const paths = getDevduckServicePaths(process.cwd());
      await ensureServiceRunning(paths.socketPath);
      const client = createDevduckServiceClient({ socketPath: paths.socketPath });
      return await client.process.status.query();
    }),

  processReadSession: t.procedure
    .input(z.object({}))
    .output(z.any())
    .meta({
      title: 'Read service session',
      description: 'Return the persisted service session (process records, baseURL).',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async () => {
      const paths = getDevduckServicePaths(process.cwd());
      await ensureServiceRunning(paths.socketPath);
      const client = createDevduckServiceClient({ socketPath: paths.socketPath });
      return await client.process.readSession.query();
    })
});

