import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { getDevduckServicePaths } from '../../scripts/devduck-service/src/paths.js';
import { ProcessManager } from '../../scripts/devduck-service/src/process/ProcessManager.js';
import { isPidAlive } from '../../scripts/devduck-service/src/pids.js';

function rmCache(rootDir: string) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

async function waitForFile(filePath: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise<void>(r => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for file: ${filePath}`);
}

async function waitForContent(filePath: string, re: RegExp, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const s = fs.readFileSync(filePath, 'utf8');
      if (re.test(s)) return;
    } catch {
      // ignore
    }
    await new Promise<void>(r => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for content in: ${filePath}`);
}

test('ProcessManager writes stdout/stderr logs', async () => {
  const paths = getDevduckServicePaths(process.cwd());
  rmCache(paths.rootDir);

  const pm = new ProcessManager({ sessionPath: paths.sessionPath, logsDir: paths.logsDir });
  const fixture = path.join(process.cwd(), 'tests', 'devduck-service', 'fixtures', 'loggy-process.mjs');

  const rec = pm.start({ name: 'loggy', command: process.execPath, args: [fixture], env: {} });
  assert.ok(rec.pid > 0);

  await waitForFile(rec.outLogPath, 2_000);
  await waitForFile(rec.errLogPath, 2_000);

  await waitForContent(rec.outLogPath, /LOGGY_START stdout/, 2_000);
  await waitForContent(rec.errLogPath, /LOGGY_START stderr/, 2_000);

  const status = pm.status();
  const s = status.processes.find(p => p.name === 'loggy');
  assert.ok(s?.running, 'status shows running');

  await pm.stop('loggy', { timeoutMs: 2_000 });
});

test('stop kills a process group (parent + child)', async () => {
  const paths = getDevduckServicePaths(process.cwd());
  rmCache(paths.rootDir);
  fs.mkdirSync(paths.rootDir, { recursive: true });

  const pm = new ProcessManager({ sessionPath: paths.sessionPath, logsDir: paths.logsDir });
  const fixturesDir = path.join(process.cwd(), 'tests', 'devduck-service', 'fixtures');
  const parent = path.join(fixturesDir, 'parent-spawns-child.mjs');
  const childPidFile = path.join(paths.rootDir, 'child.pid');

  const rec = pm.start({
    name: 'tree',
    command: process.execPath,
    args: [parent],
    env: { CHILD_PID_FILE: childPidFile }
  });

  await waitForFile(childPidFile, 5_000);
  const childPid = Number(fs.readFileSync(childPidFile, 'utf8').trim());
  assert.ok(Number.isFinite(childPid) && childPid > 0);

  assert.ok(isPidAlive(rec.pid), 'parent alive');
  assert.ok(isPidAlive(childPid), 'child alive');

  await pm.stop('tree', { timeoutMs: 2_000 });

  // Give the OS time to fully reap child processes (zombies can still report as "alive" briefly).
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    if (!isPidAlive(rec.pid) && !isPidAlive(childPid)) break;
    await new Promise<void>(r => setTimeout(r, 50));
  }
  assert.equal(isPidAlive(rec.pid), false, 'parent dead');
  assert.equal(isPidAlive(childPid), false, 'child dead');
});

