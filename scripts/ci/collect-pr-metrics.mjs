#!/usr/bin/env node
/**
 * Collects CI metrics + artifacts into `.cache/` for PR runs.
 *
 * Goals:
 * - Always produce `.cache/metrics/metrics.json` (best-effort)
 * - Never hide failures: record exit codes + timings
 * - Keep it configurable via env so projects can plug in their own commands
 *
 * Key env vars:
 * - BUILD_COMMAND: optional shell command to run as "build"
 * - BUILD_OUTPUT_DIR: optional dir to size (e.g. "dist")
 * - DEV_COMMAND: optional long-running command to start in "dev mode"
 * - DEV_TIMEOUT_MS: optional, default 8000
 * - DEV_READY_REGEX: optional regex to detect "ready" from output
 * - RUN_PLAYWRIGHT_INSTALLER: "1" (default) | "0"
 * - RUN_PLAYWRIGHT_SMOKE: "1" | "0" (default is "1" only if BASE_URL is set)
 * - PLAYWRIGHT_INSTALLER_CONFIG: default "tests/installer/playwright.config.ts"
 * - PLAYWRIGHT_SMOKE_CONFIG: default "tests/smoke/playwright.config.ts"
 * - PAGE_LOAD_URLS: optional comma-separated list; requires a reachable server
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CACHE_ROOT = '.cache';
const DIRS = {
  logs: path.join(CACHE_ROOT, 'logs'),
  metrics: path.join(CACHE_ROOT, 'metrics'),
  aiLogs: path.join(CACHE_ROOT, 'ai_logs'),
  playwright: path.join(CACHE_ROOT, 'playwright'),
  tmp: path.join(CACHE_ROOT, 'tmp')
};

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

async function safeCopyDir(src, dest) {
  if (!(await pathExists(src))) return { copied: false, reason: 'missing' };
  await mkdirp(dest);
  // Node 20+ supports fs.cp; still do a conservative fallback if not present.
  if (typeof fsp.cp === 'function') {
    await fsp.cp(src, dest, { recursive: true, force: true, errorOnExist: false });
    return { copied: true };
  }
  // Fallback: copy only direct files/dirs recursively.
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (e) => {
      const from = path.join(src, e.name);
      const to = path.join(dest, e.name);
      if (e.isDirectory()) return safeCopyDir(from, to);
      if (e.isFile()) {
        await mkdirp(path.dirname(to));
        await fsp.copyFile(from, to);
      }
      return undefined;
    })
  );
  return { copied: true, fallback: true };
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

function readBoolEnv(name, defaultValue) {
  const v = process.env[name];
  if (v == null) return defaultValue;
  if (v === '1' || v.toLowerCase() === 'true') return true;
  if (v === '0' || v.toLowerCase() === 'false') return false;
  return defaultValue;
}

function readIntEnv(name, defaultValue) {
  const v = process.env[name];
  if (!v) return defaultValue;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function tryReadJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  return tryReadJsonFile(eventPath);
}

function extractPrInfo(event) {
  const pr = event?.pull_request;
  if (!pr) return undefined;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changed_files,
    base: {
      ref: pr.base?.ref,
      sha: pr.base?.sha
    },
    head: {
      ref: pr.head?.ref,
      sha: pr.head?.sha
    }
  };
}

function runCommand({
  name,
  command,
  logPath,
  timeoutMs,
  readyRegex
}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const out = fs.createWriteStream(logPath, { flags: 'a' });
    out.write(`[${nowIso()}] $ ${command}\n`);

    const child = spawn(command, {
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let timedOut = false;
    let readyAtMs;
    let stdoutBuf = '';
    let stderrBuf = '';

    function onChunk(which, chunk) {
      const text = chunk.toString('utf8');
      out.write(text);
      if (!readyRegex || readyAtMs != null) return;
      if (which === 'stdout') stdoutBuf += text;
      else stderrBuf += text;

      const buf = (stdoutBuf + '\n' + stderrBuf).slice(-32_768);
      if (readyRegex.test(buf)) {
        readyAtMs = Date.now() - start;
        out.write(`\n[${nowIso()}] ${name}: READY_REGEX matched at ${readyAtMs}ms\n`);
      }
    }

    child.stdout?.on('data', (c) => onChunk('stdout', c));
    child.stderr?.on('data', (c) => onChunk('stderr', c));

    let timer;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        out.write(`\n[${nowIso()}] ${name}: TIMEOUT after ${timeoutMs}ms, sending SIGTERM\n`);
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            out.write(`\n[${nowIso()}] ${name}: forcing SIGKILL\n`);
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 1500);
      }, timeoutMs);
    }

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - start;
      out.write(`\n[${nowIso()}] ${name}: exit=${code ?? 'null'} signal=${signal ?? 'null'} durationMs=${durationMs}\n`);
      out.end();
      resolve({
        name,
        command,
        exitCode: code,
        signal,
        timedOut,
        durationMs,
        readyAtMs
      });
    });
  });
}

async function safeWriteJson(filePath, data) {
  await mkdirp(path.dirname(filePath));
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function readPackageJson() {
  try {
    const raw = await fsp.readFile('package.json', 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function npmPack(tarballDestDir, logPath) {
  await mkdirp(tarballDestDir);
  const before = new Set(await fsp.readdir(process.cwd()));
  const res = await runCommand({
    name: 'npm-pack',
    command: 'npm pack --silent',
    logPath
  });

  // npm pack prints the filename, but we already captured logs; infer by diffing cwd.
  const after = await fsp.readdir(process.cwd());
  const created = after.filter((e) => e.endsWith('.tgz') && !before.has(e));
  const tgz = created.length > 0 ? created[0] : after.find((e) => e.endsWith('.tgz'));
  if (!tgz) {
    return { ...res, tarball: undefined, tarballBytes: 0 };
  }
  const from = path.join(process.cwd(), tgz);
  const to = path.join(tarballDestDir, tgz);
  try {
    await fsp.rename(from, to);
  } catch {
    // cross-device rename fallback
    await fsp.copyFile(from, to);
    await fsp.unlink(from);
  }
  const bytes = (await fsp.stat(to)).size;
  return { ...res, tarball: to, tarballBytes: bytes };
}

async function main() {
  await Promise.all(Object.values(DIRS).map((d) => mkdirp(d)));

  const event = readGithubEvent();
  const pr = extractPrInfo(event);

  const pkg = await readPackageJson();
  const scripts = pkg?.scripts ?? {};

  const installerConfig = process.env.PLAYWRIGHT_INSTALLER_CONFIG ?? 'tests/installer/playwright.config.ts';
  const smokeConfig = process.env.PLAYWRIGHT_SMOKE_CONFIG ?? 'tests/smoke/playwright.config.ts';

  const runInstallerPw = readBoolEnv('RUN_PLAYWRIGHT_INSTALLER', true);
  const runSmokePw =
    process.env.RUN_PLAYWRIGHT_SMOKE != null
      ? readBoolEnv('RUN_PLAYWRIGHT_SMOKE', false)
      : Boolean(process.env.BASE_URL);

  const buildCommand =
    process.env.BUILD_COMMAND ??
    (typeof scripts.build === 'string' && scripts.build.length > 0 ? 'npm run build' : undefined);

  const buildOutputDir = process.env.BUILD_OUTPUT_DIR ?? undefined;

  const devCommand = process.env.DEV_COMMAND ?? undefined;
  const devTimeoutMs = readIntEnv('DEV_TIMEOUT_MS', 8000);
  const devReadyRegex =
    process.env.DEV_READY_REGEX && process.env.DEV_READY_REGEX.length > 0
      ? new RegExp(process.env.DEV_READY_REGEX, 'i')
      : undefined;

  const results = {
    meta: {
      collectedAt: nowIso(),
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      workflow: process.env.GITHUB_WORKFLOW,
      job: process.env.GITHUB_JOB,
      sha: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF,
      node: process.version
    },
    pr,
    commands: {},
    sizes: {},
    notes: []
  };

  // Install deps
  results.commands['npm_ci'] = await runCommand({
    name: 'npm-ci',
    command: 'npm ci',
    logPath: path.join(DIRS.logs, 'npm-ci.log')
  });

  // Playwright deps (best-effort, useful for video/screenshot)
  results.commands['playwright_install'] = await runCommand({
    name: 'playwright-install',
    command: 'npx playwright install --with-deps chromium',
    logPath: path.join(DIRS.logs, 'playwright-install.log')
  });

  // Optional "dev mode" startup measurement (best-effort)
  if (devCommand) {
    results.commands['dev_start'] = await runCommand({
      name: 'dev-start',
      command: devCommand,
      logPath: path.join(DIRS.logs, 'dev-start.log'),
      timeoutMs: devTimeoutMs,
      readyRegex: devReadyRegex
    });
  } else {
    results.notes.push('DEV_COMMAND not set; dev startup metric skipped.');
  }

  // "Build" (optional)
  if (buildCommand) {
    results.commands['build'] = await runCommand({
      name: 'build',
      command: buildCommand,
      logPath: path.join(DIRS.logs, 'build.log')
    });
  } else {
    results.notes.push('BUILD_COMMAND not set and package.json has no build script; build metric skipped.');
  }

  // Unit tests (repo main test suite)
  results.commands['tests'] = await runCommand({
    name: 'tests',
    command: 'npm test',
    logPath: path.join(DIRS.logs, 'npm-test.log')
  });

  // Parse node:test timings (best-effort)
  await safeWriteJson(path.join(DIRS.metrics, 'commands.json'), results.commands);
  const parseRes = await runCommand({
    name: 'node-test-parse',
    command: `npx tsx scripts/perf/node-test-parse.ts --input ${path.join(DIRS.logs, 'npm-test.log')} --output ${path.join(
      DIRS.metrics,
      'node-test.timings.json'
    )}`,
    logPath: path.join(DIRS.logs, 'node-test-parse.log')
  });
  results.commands['node_test_parse'] = parseRes;

  // Playwright: installer tests (recommended for PR artifacts)
  if (runInstallerPw) {
    results.commands['pw_installer'] = await runCommand({
      name: 'pw-installer',
      command: [
        'npx playwright test',
        `-c ${installerConfig}`,
        '--reporter=list',
        '--trace=retain-on-failure',
        '--video=retain-on-failure',
        '--screenshot=only-on-failure'
      ].join(' '),
      logPath: path.join(DIRS.logs, 'pw-installer.log')
    });
  } else {
    results.notes.push('RUN_PLAYWRIGHT_INSTALLER=0; installer Playwright suite skipped.');
  }

  // Playwright: smoke tests (only meaningful with BASE_URL)
  if (runSmokePw) {
    results.commands['pw_smoke'] = await runCommand({
      name: 'pw-smoke',
      command: [
        'npx playwright test',
        `-c ${smokeConfig}`,
        '--reporter=list',
        '--trace=retain-on-failure',
        '--video=retain-on-failure',
        '--screenshot=only-on-failure'
      ].join(' '),
      logPath: path.join(DIRS.logs, 'pw-smoke.log')
    });
  } else {
    results.notes.push('RUN_PLAYWRIGHT_SMOKE disabled (or BASE_URL missing); smoke Playwright suite skipped.');
  }

  // Collect Playwright output dirs into `.cache/playwright/` for upload-artifact.
  await safeCopyDir('test-results', path.join(DIRS.playwright, 'test-results'));
  await safeCopyDir('playwright-report', path.join(DIRS.playwright, 'playwright-report'));
  await safeCopyDir('blob-report', path.join(DIRS.playwright, 'blob-report'));

  // Sizes: build output dir (optional), dist (common), and npm pack tarball size.
  if (buildOutputDir) {
    results.sizes['build_output_dir'] = {
      path: buildOutputDir,
      bytes: await dirSizeBytes(buildOutputDir)
    };
  }
  if (await pathExists('dist')) {
    results.sizes['dist'] = { path: 'dist', bytes: await dirSizeBytes('dist') };
  }

  const pack = await npmPack(DIRS.tmp, path.join(DIRS.logs, 'npm-pack.log'));
  results.commands['npm_pack'] = {
    name: pack.name,
    command: pack.command,
    exitCode: pack.exitCode,
    signal: pack.signal,
    timedOut: pack.timedOut,
    durationMs: pack.durationMs
  };
  results.sizes['npm_pack'] = {
    tarball: pack.tarball,
    bytes: pack.tarballBytes
  };

  // Minimal AI log: at least store CI context. If you have real agent logs, copy them into `.cache/ai_logs/` in your steps.
  await safeWriteJson(path.join(DIRS.aiLogs, 'ci-context.json'), {
    collectedAt: results.meta.collectedAt,
    pr: results.pr,
    meta: results.meta
  });

  await safeWriteJson(path.join(DIRS.metrics, 'metrics.json'), results);
}

// Keep the workflow non-blocking: metrics must upload even if some commands failed.
main().catch(async (err) => {
  try {
    await mkdirp(DIRS.metrics);
    await fsp.writeFile(
      path.join(DIRS.metrics, 'metrics.json'),
      JSON.stringify(
        {
          meta: { collectedAt: nowIso(), node: process.version },
          fatalError: { message: String(err?.message ?? err), stack: String(err?.stack ?? '') }
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  } catch {
    // ignore
  }
  process.exitCode = 0;
});

