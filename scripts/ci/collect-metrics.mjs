#!/usr/bin/env node
/**
 * Collects "current" metrics into `.cache/metrics/current.json`.
 *
 * This script MUST NOT run tests. Tests are executed in a separate CI step/job
 * and their timings/logs are consumed here (if present).
 *
 * Env knobs (optional):
 * - BUILD_COMMAND: command to measure (e.g. "npm run build")
 * - BUILD_OUTPUT_DIR: directory to size (e.g. "dist")
 * - DEV_COMMAND: command to start dev server (e.g. "npm run dev")
 * - DEV_READY_REGEX: regex used to detect readiness in output
 * - DEV_TIMEOUT_MS: default 8000
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CACHE_ROOT = '.cache';
const METRICS_DIR = path.join(CACHE_ROOT, 'metrics');
const LOGS_DIR = path.join(CACHE_ROOT, 'logs');
const AI_LOGS_DIR = path.join(CACHE_ROOT, 'ai_logs');

function nowIso() {
  return new Date().toISOString();
}

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirSizeBytes(p) {
  if (!(await pathExists(p))) return 0;
  const st = await fsp.stat(p);
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  const entries = await fsp.readdir(p, { withFileTypes: true });
  let total = 0;
  for (const e of entries) {
    const child = path.join(p, e.name);
    if (e.isDirectory()) total += await dirSizeBytes(child);
    else if (e.isFile()) total += (await fsp.stat(child)).size;
  }
  return total;
}

function readIntEnv(name, def) {
  const v = process.env[name];
  if (!v) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function tryReadJsonFileSync(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

function stripAnsi(s) {
  // Basic ANSI escape stripping (colors, cursor moves).
  return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/gu, '');
}

function parseNodeTestSummary(raw) {
  const text = stripAnsi(raw);
  const out = {};

  const mTests = text.match(/^\s*(?:ℹ|#)\s*tests\s+(\d+)\s*$/mu);
  if (mTests) out.total = Number.parseInt(mTests[1], 10);

  const mSuites = text.match(/^\s*(?:ℹ|#)\s*suites\s+(\d+)\s*$/mu);
  if (mSuites) out.suites = Number.parseInt(mSuites[1], 10);

  const mPass = text.match(/^\s*(?:ℹ|#)\s*pass\s+(\d+)\s*$/mu);
  if (mPass) out.passed = Number.parseInt(mPass[1], 10);

  const mFail = text.match(/^\s*(?:ℹ|#)\s*fail\s+(\d+)\s*$/mu);
  if (mFail) out.failed = Number.parseInt(mFail[1], 10);

  const mSkipped = text.match(/^\s*(?:ℹ|#)\s*skipped\s+(\d+)\s*$/mu);
  if (mSkipped) out.skipped = Number.parseInt(mSkipped[1], 10);

  // Prefer the last duration_ms line.
  const durations = [...text.matchAll(/^\s*(?:ℹ|#)\s*duration_ms\s+([\d.]+)\s*$/gmu)];
  if (durations.length > 0) {
    const last = durations[durations.length - 1][1];
    out.reportedDurationMs = Number.parseFloat(last);
  }

  return out;
}

function parsePlaywrightSummary(raw) {
  const text = stripAnsi(raw);
  const out = {};

  const mRunning = text.match(/Running\s+(\d+)\s+tests\b/iu);
  if (mRunning) out.total = Number.parseInt(mRunning[1], 10);

  // Prefer the final summary line(s):
  // - "34 passed (23.3s)"
  // - "3 failed"
  // - "31 passed (1.4m)"
  const summaryLines = [
    ...text.matchAll(/^\s*(\d+)\s+passed\s+\(([\d.]+)\s*(ms|s|m)\)\s*$/gmu)
  ];
  if (summaryLines.length > 0) {
    const last = summaryLines[summaryLines.length - 1];
    out.passed = Number.parseInt(last[1], 10);
    const n = Number.parseFloat(last[2]);
    const unit = last[3];
    if (Number.isFinite(n)) out.reportedDurationMs = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60_000;
  }

  const failedLines = [...text.matchAll(/^\s*(\d+)\s+failed\b.*$/gmu)];
  if (failedLines.length > 0) {
    const last = failedLines[failedLines.length - 1];
    out.failed = Number.parseInt(last[1], 10);
  }

  const skippedLines = [...text.matchAll(/^\s*(\d+)\s+skipped\b.*$/gmu)];
  if (skippedLines.length > 0) {
    const last = skippedLines[skippedLines.length - 1];
    out.skipped = Number.parseInt(last[1], 10);
  }

  return out;
}

function readGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  return tryReadJsonFileSync(eventPath);
}

function extractPrDelta(event) {
  const pr = event?.pull_request;
  if (!pr) return undefined;
  return {
    number: pr.number,
    url: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
    title: pr.title
  };
}

function runCommandToLog({ name, command, logPath, timeoutMs, readyRegex }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const out = fs.createWriteStream(logPath, { flags: 'a' });
    out.write(`[${nowIso()}] $ ${command}\n`);

    const child = spawn(command, { shell: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });

    let timedOut = false;
    let readyAtMs;
    let buf = '';

    function onChunk(chunk) {
      const text = chunk.toString('utf8');
      out.write(text);
      if (!readyRegex || readyAtMs != null) return;
      buf = (buf + text).slice(-32_768);
      if (readyRegex.test(buf)) readyAtMs = Date.now() - start;
    }

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    let timer;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        out.write(`\n[${nowIso()}] ${name}: TIMEOUT after ${timeoutMs}ms; sending SIGTERM\n`);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1500);
      }, timeoutMs);
    }

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - start;
      out.write(`\n[${nowIso()}] ${name}: exit=${code ?? 'null'} signal=${signal ?? 'null'} durationMs=${durationMs}\n`);
      out.end();
      resolve({ name, command, exitCode: code, signal, durationMs, timedOut, readyAtMs });
    });
  });
}

async function npmPackSizeBytes(logPath) {
  const before = new Set(await fsp.readdir(process.cwd()));
  const res = await runCommandToLog({ name: 'npm-pack', command: 'npm pack --silent', logPath });
  const after = await fsp.readdir(process.cwd());
  const created = after.filter((e) => e.endsWith('.tgz') && !before.has(e));
  const tgz = created.length > 0 ? created[0] : after.find((e) => e.endsWith('.tgz'));
  if (!tgz) return { ...res, bytes: 0 };
  const bytes = (await fsp.stat(tgz)).size;
  await fsp.unlink(tgz).catch(() => {});
  return { ...res, bytes };
}

async function main() {
  await mkdirp(METRICS_DIR);
  await mkdirp(LOGS_DIR);
  await mkdirp(AI_LOGS_DIR);

  const event = readGithubEvent();
  const pr = extractPrDelta(event);

  const meta = {
    collectedAt: nowIso(),
    repository: process.env.GITHUB_REPOSITORY,
    eventName: process.env.GITHUB_EVENT_NAME,
    sha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    node: process.version
  };

  // Always emit a minimal AI/CI context log so the artifact folder is non-empty.
  await fsp.writeFile(path.join(AI_LOGS_DIR, 'ci-context.json'), JSON.stringify({ collectedAt: nowIso(), meta, pr }, null, 2) + '\n', 'utf8');

  // Consume test timings recorded by the test job (if present).
  const testCommandsPath = path.join(METRICS_DIR, 'test-commands.json');
  const testCommands = (await pathExists(testCommandsPath)) ? tryReadJsonFileSync(testCommandsPath) : undefined;

  const metrics = {
    meta,
    pr,
    commands: {
      ...(testCommands ?? {})
    },
    sizes: {},
    tests: {},
    notes: []
  };

  // Test stats (best-effort): counts + durations from logs + wall-clock from test-commands.json.
  try {
    const unitLogPath = path.join(LOGS_DIR, 'npm-test.log');
    if (await pathExists(unitLogPath)) {
      const raw = await fsp.readFile(unitLogPath, 'utf8');
      metrics.tests.unit = {
        ...parseNodeTestSummary(raw),
        durationMs: metrics.commands?.npm_test?.durationMs,
        exitCode: metrics.commands?.npm_test?.exitCode
      };
    }
  } catch {
    // ignore
  }

  try {
    const pwInstallerLogPath = path.join(LOGS_DIR, 'pw-installer.log');
    if (await pathExists(pwInstallerLogPath)) {
      const raw = await fsp.readFile(pwInstallerLogPath, 'utf8');
      metrics.tests.e2e_installer = {
        ...parsePlaywrightSummary(raw),
        durationMs: metrics.commands?.pw_installer?.durationMs,
        exitCode: metrics.commands?.pw_installer?.exitCode
      };
    }
  } catch {
    // ignore
  }

  try {
    const pwSmokeLogPath = path.join(LOGS_DIR, 'pw-smoke.log');
    if (await pathExists(pwSmokeLogPath)) {
      const raw = await fsp.readFile(pwSmokeLogPath, 'utf8');
      metrics.tests.e2e_smoke = {
        ...parsePlaywrightSummary(raw),
        durationMs: metrics.commands?.pw_smoke?.durationMs,
        exitCode: metrics.commands?.pw_smoke?.exitCode
      };
    }
  } catch {
    // ignore
  }

  // Optional build metric (no tests here).
  if (process.env.BUILD_COMMAND) {
    metrics.commands.build = await runCommandToLog({
      name: 'build',
      command: process.env.BUILD_COMMAND,
      logPath: path.join(LOGS_DIR, 'build.log')
    });
  } else {
    metrics.notes.push('BUILD_COMMAND not set; build metric skipped.');
  }

  // Optional dev-start metric (best-effort; will terminate after timeout).
  if (process.env.DEV_COMMAND) {
    const timeoutMs = readIntEnv('DEV_TIMEOUT_MS', 8000);
    const readyRegex =
      process.env.DEV_READY_REGEX && process.env.DEV_READY_REGEX.length > 0
        ? new RegExp(process.env.DEV_READY_REGEX, 'i')
        : undefined;
    metrics.commands.dev_start = await runCommandToLog({
      name: 'dev-start',
      command: process.env.DEV_COMMAND,
      logPath: path.join(LOGS_DIR, 'dev-start.log'),
      timeoutMs,
      readyRegex
    });
  } else {
    metrics.notes.push('DEV_COMMAND not set; dev startup metric skipped.');
  }

  // Bundle/build output size (optional).
  if (process.env.BUILD_OUTPUT_DIR) {
    metrics.sizes.build_output_dir = {
      path: process.env.BUILD_OUTPUT_DIR,
      bytes: await dirSizeBytes(process.env.BUILD_OUTPUT_DIR)
    };
  }

  if (await pathExists('dist')) {
    metrics.sizes.dist = { path: 'dist', bytes: await dirSizeBytes('dist') };
  }

  // Always compute a package size proxy.
  const pack = await npmPackSizeBytes(path.join(LOGS_DIR, 'npm-pack.log'));
  metrics.commands.npm_pack = { name: pack.name, command: pack.command, exitCode: pack.exitCode, durationMs: pack.durationMs };
  metrics.sizes.npm_pack = { bytes: pack.bytes };

  // Write `current.json`
  const outPath = path.join(METRICS_DIR, 'current.json');
  await fsp.writeFile(outPath, JSON.stringify(metrics, null, 2) + '\n', 'utf8');

  // Human-friendly summary for CI logs.
  const buildMs = metrics?.commands?.build?.durationMs;
  const devReadyMs = metrics?.commands?.dev_start?.readyAtMs;
  const packBytes = metrics?.sizes?.npm_pack?.bytes;
  const distBytes = metrics?.sizes?.dist?.bytes;
  const outBytes = metrics?.sizes?.build_output_dir?.bytes;
  // eslint-disable-next-line no-console
  console.log('[metrics] wrote', outPath);
  // eslint-disable-next-line no-console
  console.log('[metrics] build:', buildMs ?? 'n/a', 'ms; devReady:', devReadyMs ?? 'n/a', 'ms');
  // eslint-disable-next-line no-console
  console.log('[metrics] npm_pack:', packBytes ?? 'n/a', 'bytes; dist:', distBytes ?? 'n/a', 'bytes; build_out:', outBytes ?? 'n/a', 'bytes');
  // eslint-disable-next-line no-console
  console.log(
    '[metrics] tests:',
    'unit',
    metrics.tests?.unit?.total ?? 'n/a',
    `(${metrics.tests?.unit?.reportedDurationMs ?? metrics.tests?.unit?.durationMs ?? 'n/a'}ms);`,
    'e2e',
    metrics.tests?.e2e_installer?.total ?? 'n/a',
    `(${metrics.tests?.e2e_installer?.reportedDurationMs ?? metrics.tests?.e2e_installer?.durationMs ?? 'n/a'}ms)`
  );
}

main().catch(async (err) => {
  await mkdirp(METRICS_DIR);
  await fsp.writeFile(
    path.join(METRICS_DIR, 'current.json'),
    JSON.stringify({ meta: { collectedAt: nowIso(), node: process.version }, fatalError: String(err?.stack ?? err) }, null, 2) + '\n',
    'utf8'
  );
  process.exitCode = 0;
});

