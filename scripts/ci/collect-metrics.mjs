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
import { spawn, spawnSync } from 'node:child_process';

const CACHE_ROOT = '.cache';
const METRICS_DIR = path.join(CACHE_ROOT, 'metrics');
const LOGS_DIR = path.join(CACHE_ROOT, 'logs');
const AI_LOGS_DIR = path.join(CACHE_ROOT, 'ai_logs');
const COVERAGE_DIR = path.join(CACHE_ROOT, 'coverage');

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

function countLines(text) {
  const s = String(text);
  if (s.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) n++;
  }
  return n;
}

function listGitFilesOrEmpty() {
  try {
    const res = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    if (res.status !== 0 || !res.stdout) return [];
    return res.stdout.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function isCodeExt(ext) {
  return (
    ext === '.ts' ||
    ext === '.tsx' ||
    ext === '.mts' ||
    ext === '.cts' ||
    ext === '.js' ||
    ext === '.jsx' ||
    ext === '.mjs' ||
    ext === '.cjs'
  );
}

function isTsOrJsScriptExt(ext) {
  // "Scripts" in the request: treat TS/JS variants as scripts.
  return isCodeExt(ext);
}

function isLikelyTextBuffer(buf) {
  // Simple binary guard: treat NUL bytes as binary.
  // (Not perfect, but good enough for configs/docs/code in a repo.)
  if (!buf || buf.length === 0) return true;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return false;
  }
  return true;
}

function parsePlaywrightFlakyTestIds(raw) {
  const text = stripAnsi(raw);
  const lines = text.split(/\r?\n/gu);
  const ids = new Set();
  for (const line of lines) {
    if (!/\bretry\s*#\s*\d+\b/iu.test(line)) continue;
    const normalized = line.replace(/\s*\(retry\s*#\s*\d+\)\s*/giu, '').trim();
    if (normalized) ids.add(normalized);
  }
  return ids;
}

function buildFullTitle(pathParts) {
  const parts = Array.isArray(pathParts) ? pathParts.filter(Boolean).map((x) => String(x).trim()).filter(Boolean) : [];
  return parts.join(' > ');
}

function parseNodeTestCases(raw) {
  // Best-effort parser matching `scripts/perf/node-test-parse.ts`.
  const text = stripAnsi(raw);
  const lines = text.split(/\r?\n/gu);

  const SUITE_START_RE = /^(\s*)▶\s+(.*)$/u;
  const RESULT_RE = /^(\s*)([✔✖﹣])\s+(.*?)\s+\(([\d.]+)ms\)(.*)$/u;

  /** @type {Array<{title:string, indent:number}>} */
  const suites = [];
  /** @type {Array<{fullTitle:string, title:string, suitePath:string[], status:'passed'|'failed'|'skipped', durationMs:number}>} */
  const testCases = [];

  for (const line of lines) {
    const suiteMatch = line.match(SUITE_START_RE);
    if (suiteMatch) {
      const indent = suiteMatch[1].length;
      const title = suiteMatch[2].trim();

      while (suites.length > 0 && indent < suites[suites.length - 1].indent) suites.pop();
      suites.push({ title, indent });
      continue;
    }

    const resultMatch = line.match(RESULT_RE);
    if (resultMatch) {
      const indent = resultMatch[1].length;
      const symbol = resultMatch[2];
      const title = resultMatch[3].trim();
      const durationMs = Number.parseFloat(resultMatch[4]);
      const tail = resultMatch[5] ?? '';

      // Suite summary lines repeat the suite title at suite indent.
      if (suites.length > 0) {
        const top = suites[suites.length - 1];
        if (indent === top.indent && title === top.title) {
          suites.pop();
          continue;
        }
      }

      /** @type {'passed'|'failed'|'skipped'} */
      const status = tail.includes('# SKIP') || symbol === '﹣' ? 'skipped' : symbol === '✔' ? 'passed' : 'failed';
      const suitePath = suites.map((s) => s.title);
      const fullTitle = buildFullTitle([...suitePath, title]);

      testCases.push({
        fullTitle,
        title,
        suitePath,
        status,
        durationMs: Number.isFinite(durationMs) ? durationMs : 0
      });
      continue;
    }
  }

  return testCases;
}

function extractSlowTests(testCases, thresholdMs, limit = 10) {
  const executed = (Array.isArray(testCases) ? testCases : []).filter((t) => t && t.status !== 'skipped');
  const slow = executed.filter((t) => typeof t.durationMs === 'number' && Number.isFinite(t.durationMs) && t.durationMs > thresholdMs);
  slow.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
  return {
    thresholdMs,
    count: slow.length,
    top: slow.slice(0, limit).map((t) => ({ name: t.fullTitle ?? t.title ?? 'test', durationMs: t.durationMs }))
  };
}

function collectPlaywrightTestsFromJson(report) {
  /** @type {Array<{fullTitle:string, durationMs:number, status:string}>} */
  const out = [];
  const rootSuites = Array.isArray(report?.suites) ? report.suites : [];

  function walkSuite(suite, suitePath) {
    const title = suite?.title ? String(suite.title) : '';
    const nextPath = title ? [...suitePath, title] : suitePath;

    const specs = Array.isArray(suite?.specs) ? suite.specs : [];
    for (const spec of specs) {
      const specTitle = spec?.title ? String(spec.title) : '';
      const tests = Array.isArray(spec?.tests) ? spec.tests : [];
      for (const test of tests) {
        const testTitle = test?.title ? String(test.title) : specTitle || 'test';
        const results = Array.isArray(test?.results) ? test.results : [];
        const durations = results.map((r) => Number(r?.duration)).filter((n) => Number.isFinite(n));
        const durationMs = durations.length > 0 ? Math.max(...durations) : 0;
        const status = (results[results.length - 1]?.status ?? test?.status ?? 'unknown') + '';
        const fullTitle = buildFullTitle([...nextPath, specTitle, testTitle]);
        out.push({ fullTitle, durationMs, status });
      }
    }

    const childSuites = Array.isArray(suite?.suites) ? suite.suites : [];
    for (const child of childSuites) walkSuite(child, nextPath);
  }

  for (const s of rootSuites) walkSuite(s, []);
  return out;
}

async function readCoverageSummary() {
  // Produced by: `c8 --reporter=json-summary --report-dir .cache/coverage ...`
  const p = path.join(COVERAGE_DIR, 'coverage-summary.json');
  if (!(await pathExists(p))) return undefined;
  try {
    const raw = await fsp.readFile(p, 'utf8');
    const data = JSON.parse(raw);
    const total = data?.total ?? data?.['total'] ?? undefined;
    const lines = total?.lines?.pct;
    const statements = total?.statements?.pct;
    const branches = total?.branches?.pct;
    const functions = total?.functions?.pct;
    const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    return {
      linesPct: pct(lines),
      statementsPct: pct(statements),
      branchesPct: pct(branches),
      functionsPct: pct(functions)
    };
  } catch {
    return undefined;
  }
}

function readPlaywrightJsonReportOrUndefined(filePath) {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

async function runJscpdAndReadSummary() {
  // Best-effort duplication metric.
  const outDir = path.join(METRICS_DIR, 'jscpd');
  await mkdirp(outDir);

  const cmdParts = [
    'npx',
    'jscpd',
    '--silent',
    '--reporters',
    'json',
    '--output',
    `"${outDir}"`,
    '--pattern',
    '"**/*.{ts,tsx,js,jsx,mjs,cjs,cts,mts}"',
    '--ignore',
    '"**/node_modules/**"',
    '--ignore',
    '"**/.cache/**"',
    '--ignore',
    '"**/gh-pages/**"',
    '--ignore',
    '"**/projects/**"',
    '--ignore',
    '"**/dist/**"'
  ];
  const command = cmdParts.join(' ');
  await runCommandToLog({ name: 'jscpd', command, logPath: path.join(LOGS_DIR, 'jscpd.log'), timeoutMs: 60_000 });

  const candidates = [
    path.join(outDir, 'jscpd-report.json'),
    path.join(outDir, 'report.json'),
    path.join(outDir, 'jscpd.json')
  ];
  let report;
  for (const c of candidates) {
    if (await pathExists(c)) {
      report = tryReadJsonFileSync(c);
      if (report) break;
    }
  }
  if (!report) return undefined;

  const s = report?.statistics ?? report?.statistic ?? report?.stats ?? undefined;
  const total = s?.total ?? s;
  const pct = typeof total?.percentage === 'number' ? total.percentage : typeof total?.percent === 'number' ? total.percent : undefined;
  const duplicatedLines = typeof total?.duplicatedLines === 'number' ? total.duplicatedLines : undefined;
  const lines = typeof total?.lines === 'number' ? total.lines : typeof total?.totalLines === 'number' ? total.totalLines : undefined;

  return {
    duplicatedPct: typeof pct === 'number' && Number.isFinite(pct) ? pct : undefined,
    duplicatedLines: typeof duplicatedLines === 'number' && Number.isFinite(duplicatedLines) ? duplicatedLines : undefined,
    totalLines: typeof lines === 'number' && Number.isFinite(lines) ? lines : undefined
  };
}

async function computeRepoLineMetrics() {
  const files = listGitFilesOrEmpty();
  let scriptCodeLines = 0;
  let totalTextLines = 0;
  let hugeScripts = 0;

  for (const file of files) {
    // Note: CI checks out gh-pages into a sibling folder; keep repo-only metrics.
    if (file.startsWith('gh-pages/')) continue;
    const ext = path.extname(file).toLowerCase();

    let buf;
    try {
      buf = await fsp.readFile(file);
    } catch {
      continue;
    }

    if (!isLikelyTextBuffer(buf)) continue;
    const text = buf.toString('utf8');
    const lines = countLines(text);
    totalTextLines += lines;

    if (isTsOrJsScriptExt(ext)) {
      scriptCodeLines += lines;
      if (lines > 1000) hugeScripts += 1;
    }
  }

  return { scriptCodeLines, totalTextLines, hugeScripts };
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
    code: {},
    quality: {},
    notes: []
  };

  // Repo code metrics (best-effort, based on git-tracked files).
  try {
    const { scriptCodeLines, totalTextLines, hugeScripts } = await computeRepoLineMetrics();
    metrics.code = { scriptCodeLines, totalTextLines, hugeScripts };
  } catch {
    metrics.notes.push('Failed to compute repo code metrics.');
  }

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

  // Coverage metric (best-effort).
  try {
    const cov = await readCoverageSummary();
    if (cov) metrics.quality.coverage = cov;
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

  // Flaky tests: count unique tests that show a retry marker in logs.
  try {
    const flakyIds = new Set();
    const pwInstallerLogPath = path.join(LOGS_DIR, 'pw-installer.log');
    if (await pathExists(pwInstallerLogPath)) {
      const raw = await fsp.readFile(pwInstallerLogPath, 'utf8');
      for (const id of parsePlaywrightFlakyTestIds(raw)) flakyIds.add(id);
    }
    const pwSmokeLogPath = path.join(LOGS_DIR, 'pw-smoke.log');
    if (await pathExists(pwSmokeLogPath)) {
      const raw = await fsp.readFile(pwSmokeLogPath, 'utf8');
      for (const id of parsePlaywrightFlakyTestIds(raw)) flakyIds.add(id);
    }
    metrics.tests.flaky = { count: flakyIds.size };
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

  // Slow tests metric (>20s) from available logs/reports (best-effort).
  try {
    const thresholdMs = 20_000;
    const pieces = [];

    const unitLogPath = path.join(LOGS_DIR, 'npm-test.log');
    if (await pathExists(unitLogPath)) {
      const raw = await fsp.readFile(unitLogPath, 'utf8');
      const cases = parseNodeTestCases(raw);
      pieces.push({ name: 'unit', ...extractSlowTests(cases, thresholdMs, 10) });
    }

    const pwInstallerJsonPath = path.join(METRICS_DIR, 'pw-installer-report.json');
    const pwInstallerReport = readPlaywrightJsonReportOrUndefined(pwInstallerJsonPath);
    if (pwInstallerReport) {
      const cases = collectPlaywrightTestsFromJson(pwInstallerReport).map((t) => ({ ...t, status: String(t.status || '').toLowerCase() }));
      const normalized = cases.map((t) => ({
        fullTitle: t.fullTitle,
        title: t.fullTitle,
        suitePath: [],
        status: t.status.includes('skipped') ? 'skipped' : 'passed',
        durationMs: t.durationMs
      }));
      pieces.push({ name: 'pw_installer', ...extractSlowTests(normalized, thresholdMs, 10) });
    }

    const pwSmokeJsonPath = path.join(METRICS_DIR, 'pw-smoke-report.json');
    const pwSmokeReport = readPlaywrightJsonReportOrUndefined(pwSmokeJsonPath);
    if (pwSmokeReport) {
      const cases = collectPlaywrightTestsFromJson(pwSmokeReport).map((t) => ({ ...t, status: String(t.status || '').toLowerCase() }));
      const normalized = cases.map((t) => ({
        fullTitle: t.fullTitle,
        title: t.fullTitle,
        suitePath: [],
        status: t.status.includes('skipped') ? 'skipped' : 'passed',
        durationMs: t.durationMs
      }));
      pieces.push({ name: 'pw_smoke', ...extractSlowTests(normalized, thresholdMs, 10) });
    }

    const totalCount = pieces.reduce((acc, p) => acc + (p?.count ?? 0), 0);
    metrics.quality.slowTests = {
      thresholdMs,
      count: totalCount,
      bySuite: Object.fromEntries(pieces.map((p) => [p.name, { count: p.count, top: p.top }])),
    };
  } catch {
    // ignore
  }

  // Duplication metric (best-effort).
  try {
    const dup = await runJscpdAndReadSummary();
    if (dup) metrics.quality.duplication = dup;
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
  // eslint-disable-next-line no-console
  console.log(
    '[metrics] code:',
    'scriptCodeLines',
    metrics.code?.scriptCodeLines ?? 'n/a',
    '; totalTextLines',
    metrics.code?.totalTextLines ?? 'n/a',
    '; hugeScripts(>1000 LOC)',
    metrics.code?.hugeScripts ?? 'n/a',
    '; flakyTests',
    metrics.tests?.flaky?.count ?? 'n/a'
  );
  // eslint-disable-next-line no-console
  console.log(
    '[metrics] quality:',
    'coverage(lines%)',
    metrics.quality?.coverage?.linesPct ?? 'n/a',
    '; slowTests(>20s)',
    metrics.quality?.slowTests?.count ?? 'n/a',
    '; duplication(%)',
    metrics.quality?.duplication?.duplicatedPct ?? 'n/a'
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

