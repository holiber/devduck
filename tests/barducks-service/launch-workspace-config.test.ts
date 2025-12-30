import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'node:http';
import https from 'node:https';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import YAML from 'yaml';

function runLaunch(repoRoot: string, cwd: string, args: string[], opts?: { timeoutMs?: number }) {
  const cliPath = path.join(repoRoot, 'scripts', 'barducks-service', 'cli.ts');
  return spawnSync('npx', ['tsx', cliPath, ...args], {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
    timeout: opts?.timeoutMs ?? 180_000
  });
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

async function httpOk(url: string): Promise<boolean> {
  return await new Promise(resolve => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port ? Number(u.port) : undefined,
        path: u.pathname + u.search
      },
      res => {
        res.resume(); // drain
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

async function waitForUrl(url: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await httpOk(url)) return;
    await new Promise<void>(r => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for url: ${url}`);
}

test(
  'workspace config launch.dev starts processes, runs smokecheck, and supports smokecheck without args',
  { timeout: 300_000 },
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'barducks-launch-config-'));
    const port = await getFreePort();
    const baseURL = `http://127.0.0.1:${port}`;

    // Point to lightweight node fixtures (no npm install required).
    const repoRoot = process.cwd();
    const fixturesDir = path.join(repoRoot, 'tests', 'barducks-service', 'fixtures');
    const serverScript = path.join(fixturesDir, 'http-server.mjs');
    const loggyScript = path.join(fixturesDir, 'loggy-process.mjs');
    const playwrightBin = path.join(repoRoot, 'node_modules', '.bin', 'playwright');

    fs.writeFileSync(
      path.join(tmp, 'workspace.config.yml'),
      YAML.stringify(
        {
          version: '0.1.0',
          launch: {
            dev: {
              baseURL,
              processes: [
                {
                  name: 'server',
                  command: process.execPath,
                  args: [serverScript],
                  env: { PORT: String(port) },
                  ready: { type: 'http', url: '/' } // relative: should resolve against baseURL
                },
                {
                  name: 'client',
                  command: process.execPath,
                  args: [loggyScript]
                }
              ],
              smokecheck: {
                // Run Playwright from repo root deps (avoid npx downloading in tmp cwd).
                command: playwrightBin,
                args: [
                  'test',
                  path.join(repoRoot, 'tests', 'smoke', 'basic.spec.ts'),
                  '--config',
                  path.join(repoRoot, 'tests', 'smoke', 'playwright.config.ts')
                ]
              }
            }
          }
        }
      ),
      'utf8'
    );

    try {
      const dev = runLaunch(repoRoot, tmp, ['dev'], { timeoutMs: 240_000 });
      assert.equal(
        dev.status,
        0,
        `dev exit code: ${dev.status}\nerror: ${String(dev.error)}\n${dev.stderr}\n${dev.stdout}`
      );
      const out = JSON.parse(dev.stdout) as { ok: boolean; baseURL: string };
      assert.equal(out.ok, true);
      assert.equal(out.baseURL, baseURL);

      // ensure server is really reachable
      await waitForUrl(baseURL, 10_000);

      // smokecheck (no args) should reuse session + run config smokecheck
      const smoke = runLaunch(repoRoot, tmp, ['smokecheck'], { timeoutMs: 240_000 });
      assert.equal(
        smoke.status,
        0,
        `smokecheck exit code: ${smoke.status}\nerror: ${String(smoke.error)}\n${smoke.stderr}\n${smoke.stdout}`
      );

      const status = runLaunch(repoRoot, tmp, ['status']);
      assert.equal(status.status, 0, status.stderr);
      const parsed = JSON.parse(status.stdout) as {
        status: { processes: Array<{ name: string; pid: number; running: boolean }> };
        session: { baseURL?: string };
      };
      assert.equal(parsed.session.baseURL, baseURL);
      assert.ok(parsed.status.processes.find(p => p.name === 'server')?.running, 'server running');
      assert.ok(parsed.status.processes.find(p => p.name === 'client')?.running, 'client running');

      const stop = runLaunch(repoRoot, tmp, ['stop']);
      assert.equal(stop.status, 0, stop.stderr);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
);

