#!/usr/bin/env node

import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire } from 'module';
import { getDevduckServicePaths } from './paths.js';
import { createDevduckServiceClient } from './ipc/ipc-client.js';

const require = createRequire(import.meta.url);
const tsxImportPath: string = require.resolve('tsx');

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function canConnect(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
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

  // Start service in the background.
  const paths = getDevduckServicePaths(process.cwd());
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const outLogPath = path.join(paths.logsDir, 'service.out.log');
  const errLogPath = path.join(paths.logsDir, 'service.err.log');

  let outFd: number | undefined;
  let errFd: number | undefined;
  try {
    outFd = fs.openSync(outLogPath, 'a');
    errFd = fs.openSync(errLogPath, 'a');

    const serviceEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'service.ts');
    // Prefer running via the current Node runtime to avoid `npx`/PATH differences in tests.
    // Use an absolute tsx import path so this works even when cwd has no node_modules.
    const child = spawn(process.execPath, ['--import', tsxImportPath, serviceEntry], {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: { ...process.env },
      cwd: process.cwd()
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

async function waitHttpReady(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(100);
  }
  throw new Error(`Readiness timeout: ${url}`);
}

function resolveReadyUrl(baseURL: string | undefined, url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (!baseURL) throw new Error(`Relative ready.url "${url}" requires baseURL`);
  return new URL(url, baseURL).toString();
}

async function runCommandToLogs(params: {
  cwd: string;
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  logBaseName: string;
}): Promise<{ exitCode: number; stdoutLogPath: string; stderrLogPath: string }> {
  const paths = getDevduckServicePaths(process.cwd());
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const stdoutLogPath = path.join(paths.logsDir, `${params.logBaseName}.out.log`);
  const stderrLogPath = path.join(paths.logsDir, `${params.logBaseName}.err.log`);

  const out = fs.createWriteStream(stdoutLogPath, { flags: 'a' });
  const err = fs.createWriteStream(stderrLogPath, { flags: 'a' });

  const child = spawn(params.command, params.args, {
    cwd: params.cwd,
    env: { ...process.env, ...params.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(err);

  const exitCode: number = await new Promise(resolve => {
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      out.end();
      err.end();
      resolve(code);
    };

    child.once('close', code => finish(code ?? 1));
    child.once('error', () => finish(1));
  });
  return { exitCode, stdoutLogPath, stderrLogPath };
}

type LaunchReady = { type?: string; url?: string };
type LaunchProcess = {
  name: string;
  cwd?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  ready?: LaunchReady;
};
type LaunchSmokecheck =
  | { testFile: string; configFile?: string }
  | { cwd?: string; command: string; args?: string[]; env?: Record<string, string> };
type LaunchDev = { baseURL?: string; processes?: LaunchProcess[]; smokecheck?: LaunchSmokecheck };

function tryReadLaunchDevFromWorkspaceConfig(cwd: string): LaunchDev | null {
  try {
    const configPath = path.join(cwd, 'workspace.config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { launch?: { dev?: LaunchDev } };
    const dev = parsed?.launch?.dev;
    if (!dev || typeof dev !== 'object') return null;
    return dev;
  } catch {
    return null;
  }
}

async function cmdDev(
  client: ReturnType<typeof createDevduckServiceClient>,
  opts?: { skipSmokecheck?: boolean }
) {
  const launchDev = tryReadLaunchDevFromWorkspaceConfig(process.cwd());
  const session = await client.process.readSession.query();
  const status = await client.process.status.query();
  const serverRunning = status.processes.find(p => p.name === 'server')?.running ?? false;

  let baseURL = session.baseURL;
  if (launchDev?.baseURL) {
    baseURL = launchDev.baseURL;
    await client.process.setBaseURL.mutate({ baseURL });
  } else if (!baseURL || !serverRunning) {
    const port = await getFreePort();
    baseURL = `http://127.0.0.1:${port}`;
    await client.process.setBaseURL.mutate({ baseURL });
  }

  if (launchDev?.processes?.length) {
    for (const p of launchDev.processes) {
      const running = status.processes.find(s => s.name === p.name)?.running ?? false;
      if (running) continue;
      await client.process.start.mutate({
        name: p.name,
        command: p.command,
        args: p.args ?? [],
        cwd: p.cwd ? path.resolve(process.cwd(), p.cwd) : undefined,
        env: p.env ?? {}
      });
    }

    for (const p of launchDev.processes) {
      const ready = p.ready;
      if (ready?.type === 'http' && ready.url) {
        await waitHttpReady(resolveReadyUrl(baseURL, ready.url), 120_000);
      }
    }

    const smoke = launchDev.smokecheck;
    if (smoke && !opts?.skipSmokecheck) {
      if ('testFile' in smoke) {
        const configFile = smoke.configFile ? path.resolve(process.cwd(), smoke.configFile) : undefined;
        const result = await client.playwright.runSmokecheck.mutate({
          testFile: path.resolve(process.cwd(), smoke.testFile),
          baseURL: baseURL || '',
          configFile
        });

        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.error(
            JSON.stringify(
              {
                ok: false,
                exitCode: result.exitCode,
                logs: {
                  playwrightStdout: result.stdoutLogPath,
                  playwrightStderr: result.stderrLogPath,
                  browserConsole: (await client.playwright.ensureBrowserConsoleLogging.mutate()).logPath
                }
              },
              null,
              2
            )
          );
          process.exitCode = result.exitCode || 1;
          return;
        }
      } else {
        const browserConsole = (await client.playwright.ensureBrowserConsoleLogging.mutate()).logPath;
        const cwd = smoke.cwd ? path.resolve(process.cwd(), smoke.cwd) : process.cwd();
        const res = await runCommandToLogs({
          cwd,
          command: smoke.command,
          args: smoke.args ?? [],
          env: {
            CI: '1',
            BASE_URL: baseURL,
            BROWSER_CONSOLE_LOG_PATH: browserConsole,
            PW_TEST_HTML_REPORT_OPEN: 'never',
            ...(smoke.env ?? {})
          },
          logBaseName: 'launch-smokecheck'
        });
        if (res.exitCode !== 0) {
          // eslint-disable-next-line no-console
          console.error(
            JSON.stringify(
              {
                ok: false,
                exitCode: res.exitCode,
                logs: {
                  smokecheckStdout: res.stdoutLogPath,
                  smokecheckStderr: res.stderrLogPath,
                  browserConsole
                }
              },
              null,
              2
            )
          );
          process.exitCode = res.exitCode || 1;
          return;
        }
      }
    }

    const logPath = (await client.playwright.ensureBrowserConsoleLogging.mutate()).logPath;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          baseURL,
          logs: {
            browserConsole: logPath
          }
        },
        null,
        2
      )
    );
    return;
  }

  const fixturesDir = path.join(process.cwd(), 'tests', 'devduck-service', 'fixtures');
  const serverScript = path.join(fixturesDir, 'http-server.mjs');
  const loggyScript = path.join(fixturesDir, 'loggy-process.mjs');

  const legacyServerRunning = status.processes.find(p => p.name === 'server')?.running ?? false;
  const legacyClientRunning = status.processes.find(p => p.name === 'client')?.running ?? false;

  if (!legacyServerRunning) {
    const url = new URL(baseURL);
    await client.process.start.mutate({
      name: 'server',
      command: process.execPath,
      args: [serverScript],
      env: { PORT: String(url.port) }
    });
  }

  if (!legacyClientRunning) {
    await client.process.start.mutate({
      name: 'client',
      command: process.execPath,
      args: [loggyScript],
      env: {}
    });
  }

  await waitHttpReady(baseURL, 10_000);

  const defaultSpec = path.join(process.cwd(), 'tests', 'smoke', 'basic.spec.ts');
  const configFile = path.join(process.cwd(), 'tests', 'smoke', 'playwright.config.ts');
  const result = await client.playwright.runSmokecheck.mutate({
    testFile: defaultSpec,
    baseURL,
    configFile
  });

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify(
        {
          ok: false,
          exitCode: result.exitCode,
          logs: {
            playwrightStdout: result.stdoutLogPath,
            playwrightStderr: result.stderrLogPath,
            browserConsole: (await client.playwright.ensureBrowserConsoleLogging.mutate()).logPath
          }
        },
        null,
        2
      )
    );
    process.exitCode = result.exitCode || 1;
    return;
  }

  const logPath = (await client.playwright.ensureBrowserConsoleLogging.mutate()).logPath;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseURL,
        logs: {
          serverOut: (await client.process.readSession.query()).processes.find(p => p.name === 'server')?.outLogPath,
          serverErr: (await client.process.readSession.query()).processes.find(p => p.name === 'server')?.errLogPath,
          clientOut: (await client.process.readSession.query()).processes.find(p => p.name === 'client')?.outLogPath,
          clientErr: (await client.process.readSession.query()).processes.find(p => p.name === 'client')?.errLogPath,
          browserConsole: logPath
        }
      },
      null,
      2
    )
  );
}

async function cmdSmokecheck(client: ReturnType<typeof createDevduckServiceClient>, testFile: string) {
  const session = await client.process.readSession.query();
  const baseURL = session.baseURL;
  if (!baseURL) throw new Error('No baseURL in session (run `dev` first)');

  const configFile = path.join(process.cwd(), 'tests', 'smoke', 'playwright.config.ts');
  const result = await client.playwright.runSmokecheck.mutate({
    testFile,
    baseURL,
    configFile
  });
  process.exitCode = result.exitCode;
}

async function cmdSmokecheckFromConfig(client: ReturnType<typeof createDevduckServiceClient>) {
  const session = await client.process.readSession.query();
  if (!session.baseURL) {
    await cmdDev(client, { skipSmokecheck: true });
  }
  const session2 = await client.process.readSession.query();
  const baseURL = session2.baseURL;
  if (!baseURL) throw new Error('No baseURL in session (run `dev` first)');

  const launchDev = tryReadLaunchDevFromWorkspaceConfig(process.cwd());
  const smoke = launchDev?.smokecheck;
  if (!smoke) throw new Error('No launch.dev.smokecheck in workspace.config.json');

  if ('testFile' in smoke) {
    const result = await client.playwright.runSmokecheck.mutate({
      testFile: path.resolve(process.cwd(), smoke.testFile),
      baseURL,
      configFile: smoke.configFile ? path.resolve(process.cwd(), smoke.configFile) : undefined
    });
    process.exitCode = result.exitCode;
    return;
  }

  const browserConsole = (await client.playwright.ensureBrowserConsoleLogging.mutate()).logPath;
  const cwd = smoke.cwd ? path.resolve(process.cwd(), smoke.cwd) : process.cwd();
  const res = await runCommandToLogs({
    cwd,
    command: smoke.command,
    args: smoke.args ?? [],
    env: {
      CI: '1',
      BASE_URL: baseURL,
      BROWSER_CONSOLE_LOG_PATH: browserConsole,
      PW_TEST_HTML_REPORT_OPEN: 'never',
      ...(smoke.env ?? {})
    },
    logBaseName: 'launch-smokecheck'
  });
  process.exitCode = res.exitCode;
}

async function cmdStatus(client: ReturnType<typeof createDevduckServiceClient>) {
  const status = await client.process.status.query();
  const session = await client.process.readSession.query();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ status, session }, null, 2));
}

async function cmdStop(client: ReturnType<typeof createDevduckServiceClient>, name?: string) {
  const session = await client.process.readSession.query();
  const targets = name ? [name] : session.processes.map(p => p.name);
  for (const t of targets) {
    await client.process.stop.mutate({ name: t, timeoutMs: 2_000 });
  }
}

async function main(argv = process.argv): Promise<void> {
  const paths = getDevduckServicePaths(process.cwd());
  const args = argv.slice(2);
  const command = args[0] || '';

  await ensureServiceRunning(paths.socketPath);
  const client = createDevduckServiceClient({ socketPath: paths.socketPath });

  if (command === 'dev') {
    await cmdDev(client);
    return;
  }
  if (command === 'smokecheck') {
    const file = args[1];
    if (!file) {
      await cmdSmokecheckFromConfig(client);
      return;
    }
    await cmdSmokecheck(client, path.resolve(process.cwd(), file));
    return;
  }
  if (command === 'status') {
    await cmdStatus(client);
    return;
  }
  if (command === 'stop') {
    await cmdStop(client, args[1]);
    return;
  }

  throw new Error(
    `Unknown command: ${command || '(empty)'} (expected: dev | smokecheck [file] | status | stop [name])`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  });
}

