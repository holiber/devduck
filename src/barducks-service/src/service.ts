#!/usr/bin/env node

import fs from 'fs';
import net from 'net';
import path from 'path';
import { BarducksService } from './BarducksService.js';
import { ensureDirSync, readJsonIfExistsSync, safeUnlinkSync, writeJsonAtomicSync } from './fs-utils.js';
import { getBarducksServicePaths } from './paths.js';
import { isPidAlive } from './pids.js';
import { startBarducksIpcServer } from './ipc/ipc-server.js';

type LockFile = { pid: number; startedAt: string };

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function acquireSingletonLock(lockPath: string, socketPath: string): Promise<boolean> {
  ensureDirSync(path.dirname(lockPath));
  const existing = readJsonIfExistsSync<LockFile>(lockPath);
  if (existing?.pid && isPidAlive(existing.pid)) {
    const ok = await canConnect(socketPath);
    if (ok) return false;
  }
  safeUnlinkSync(lockPath);
  writeJsonAtomicSync(lockPath, { pid: process.pid, startedAt: new Date().toISOString() } satisfies LockFile);
  return true;
}

async function main(): Promise<void> {
  const paths = getBarducksServicePaths(process.cwd());
  ensureDirSync(paths.rootDir);
  ensureDirSync(paths.logsDir);
  ensureDirSync(paths.ipcDir);

  const locked = await acquireSingletonLock(paths.lockPath, paths.socketPath);
  if (!locked) {
    // eslint-disable-next-line no-console
    console.log(`BarducksService already running (socket: ${paths.socketPath})`);
    return;
  }

  // If a previous run crashed, the socket file might still exist.
  if (fs.existsSync(paths.socketPath)) {
    safeUnlinkSync(paths.socketPath);
  }

  const service = new BarducksService(paths);
  const server = startBarducksIpcServer({ socketPath: paths.socketPath, service });

  const shutdown = () => {
    try {
      server.close();
    } catch {
      // ignore
    }
    safeUnlinkSync(paths.socketPath);
    safeUnlinkSync(paths.lockPath);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // eslint-disable-next-line no-console
  console.log(`BarducksService listening on ${paths.socketPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  });
}

export { main };

