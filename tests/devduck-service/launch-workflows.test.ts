import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { getDevduckServicePaths } from '../../scripts/devduck-service/src/paths.js';
import { isPidAlive } from '../../scripts/devduck-service/src/pids.js';

function runLaunch(args: string[], opts?: { timeoutMs?: number }) {
  return spawnSync('npx', ['tsx', 'scripts/devduck-service/src/cli.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    timeout: opts?.timeoutMs ?? 180_000
  });
}

async function killService(): Promise<void> {
  const paths = getDevduckServicePaths(process.cwd());
  const raw = fs.existsSync(paths.lockPath) ? fs.readFileSync(paths.lockPath, 'utf8') : '';
  if (!raw) return;
  const lock = JSON.parse(raw) as { pid?: number };
  if (!lock.pid) return;

  try {
    process.kill(lock.pid, 'SIGTERM');
  } catch {
    return;
  }

  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (!isPidAlive(lock.pid)) return;
    await new Promise<void>(r => setTimeout(r, 50));
  }
}

test(
  'launch dev starts background processes, runs smokecheck, captures browser console, and allows reuse',
  { timeout: 300_000 },
  async () => {
  const paths = getDevduckServicePaths(process.cwd());
  fs.rmSync(paths.rootDir, { recursive: true, force: true });

  const dev = runLaunch(['dev'], { timeoutMs: 240_000 });
  assert.equal(dev.status, 0, `dev exit code: ${dev.status}\n${dev.stderr}`);
  const devOut = JSON.parse(dev.stdout) as { ok: boolean; baseURL: string };
  assert.equal(devOut.ok, true);
  assert.ok(devOut.baseURL.startsWith('http://127.0.0.1:'), 'baseURL set');

  // launch dev should exit while processes are still running
  const status1 = runLaunch(['status']);
  assert.equal(status1.status, 0, status1.stderr);
  const parsed1 = JSON.parse(status1.stdout) as {
    status: { processes: Array<{ name: string; pid: number; running: boolean }> };
    session: { baseURL?: string };
  };
  const server1 = parsed1.status.processes.find(p => p.name === 'server');
  const client1 = parsed1.status.processes.find(p => p.name === 'client');
  assert.ok(server1?.running, 'server running');
  assert.ok(client1?.running, 'client running');
  assert.equal(parsed1.session.baseURL, devOut.baseURL);

  // browser console logs should be captured to a file
  const browserLog = path.join(paths.logsDir, 'browser-console.log');
  assert.ok(fs.existsSync(browserLog), 'browser console log exists');
  const browserContent = fs.readFileSync(browserLog, 'utf8');
  assert.match(browserContent, /DEV_DUCK_SMOKE_OK/);
  assert.match(browserContent, /DEV_DUCK_SMOKE_ERR/);

  // smokecheck should reuse already running session (no PID changes)
  const smoke = runLaunch(['smokecheck', 'tests/smoke/basic.spec.ts'], { timeoutMs: 240_000 });
  assert.equal(smoke.status, 0, `smokecheck exit code: ${smoke.status}\n${smoke.stderr}\n${smoke.stdout}`);

  const status2 = runLaunch(['status']);
  assert.equal(status2.status, 0, status2.stderr);
  const parsed2 = JSON.parse(status2.stdout) as {
    status: { processes: Array<{ name: string; pid: number; running: boolean }> };
  };
  const server2 = parsed2.status.processes.find(p => p.name === 'server');
  const client2 = parsed2.status.processes.find(p => p.name === 'client');
  assert.equal(server2?.pid, server1?.pid, 'server pid reused');
  assert.equal(client2?.pid, client1?.pid, 'client pid reused');

  // stop should kill everything we started
  const stop = runLaunch(['stop']);
  assert.equal(stop.status, 0, stop.stderr);

  await killService();
  fs.rmSync(paths.rootDir, { recursive: true, force: true });
  }
);

