#!/usr/bin/env node
/**
 * Phase 0 baseline capture for the current Node.js test runner (pre-Playwright migration).
 *
 * It runs:
 * - `npm test` (raw log + wall time)
 * - the same suite with Node TAP reporter (parsed per-test `duration_ms`)
 *
 * Output is written under:
 * - `tests/perf/`
 * - `projects/devduck/tests/perf/` (mirror for requested path compatibility)
 */

import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { createWriteStream, readdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseNodeTapDurations, type TapTestTiming } from './tap-timings.js';

type CmdResult = {
  exitCode: number;
  wallTimeMs: number;
};

function utcTimestamp(): string {
  // 2025-12-28T12-34-56Z (filesystem-friendly)
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function getStdout(command: string, args: string[], cwd: string): string {
  const res = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) return 'unknown';
  return (res.stdout ?? '').toString().trim();
}

function runAndTee(opts: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath: string;
  alsoStdout?: boolean;
}): Promise<CmdResult> {
  const { command, args, cwd, env, logPath, alsoStdout } = opts;

  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const logStream = createWriteStream(logPath, { flags: 'wx' });

    const onChunk = (chunk: Buffer) => {
      logStream.write(chunk);
      if (alsoStdout) process.stdout.write(chunk);
    };
    const onErrChunk = (chunk: Buffer) => {
      logStream.write(chunk);
      if (alsoStdout) process.stderr.write(chunk);
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onErrChunk);

    child.on('error', err => {
      logStream.end();
      reject(err);
    });
    child.on('close', code => {
      const wallTimeMs = performance.now() - start;
      logStream.end();
      resolve({ exitCode: code ?? 1, wallTimeMs });
    });
  });
}

function findTestFiles(dir: string, acc: string[] = []): string[] {
  // Keep this in sync with `scripts/run-tests.ts`.
  // We intentionally keep the same file discovery rules for baseline parity.
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findTestFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

function computeFastestPercent(timings: TapTestTiming[], percent: number): TapTestTiming[] {
  if (timings.length === 0) return [];
  const p = Math.max(0, Math.min(100, percent));
  const k = Math.max(1, Math.ceil((timings.length * p) / 100));
  return [...timings].sort((a, b) => a.durationMs - b.durationMs).slice(0, k);
}

function isInstallerTiming(t: TapTestTiming): boolean {
  const root = t.rootSuite;
  return (
    root.includes('Installer') ||
    root.startsWith('installer:') ||
    root === 'Installation Steps' ||
    root === 'Install Project Scripts' ||
    root === 'workspace modules patterns' ||
    root.startsWith('devduck new')
  );
}

async function writeBoth(relPath: string, content: string | Buffer) {
  const outA = path.join(process.cwd(), 'tests', 'perf', relPath);
  const outB = path.join(process.cwd(), 'projects', 'devduck', 'tests', 'perf', relPath);
  await ensureDir(path.dirname(outA));
  await ensureDir(path.dirname(outB));
  await fs.writeFile(outA, content, { flag: 'wx' });
  await fs.writeFile(outB, content, { flag: 'wx' });
}

async function mirrorPerfArtifact(relPath: string) {
  const src = path.join(process.cwd(), 'tests', 'perf', relPath);
  const dst = path.join(process.cwd(), 'projects', 'devduck', 'tests', 'perf', relPath);
  await ensureDir(path.dirname(dst));
  let exists = true;
  try {
    await fs.access(dst);
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error(`Refusing to overwrite existing mirror artifact: ${dst}`);
  }
  await fs.copyFile(src, dst);
}

async function main() {
  const ts = utcTimestamp();
  const repoRoot = process.cwd();

  await ensureDir(path.join(repoRoot, 'tests', 'perf'));
  await ensureDir(path.join(repoRoot, 'projects', 'devduck', 'tests', 'perf'));

  const nodeVersion = process.version;
  const npmVersion = getStdout('npm', ['--version'], repoRoot);

  const rawLogRel = `baseline-${ts}-npm-test.log`;
  const tapLogRel = `baseline-${ts}-tap.log`;

  // 1) Raw `npm test`
  const raw = await runAndTee({
    command: 'npm',
    args: ['test'],
    cwd: repoRoot,
    logPath: path.join(repoRoot, 'tests', 'perf', rawLogRel),
    alsoStdout: true
  });
  if (raw.exitCode !== 0) {
    throw new Error(`npm test failed with exit code ${raw.exitCode}`);
  }

  // 2) TAP run for timings (same discovery rules as scripts/run-tests.ts)
  // Avoid piping (EPIPE) — we capture everything to a log file.
  const testFiles = findTestFiles(path.join(repoRoot, 'tests'));
  const tap = await runAndTee({
    command: 'npx',
    args: ['tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...testFiles],
    cwd: repoRoot,
    logPath: path.join(repoRoot, 'tests', 'perf', tapLogRel),
    alsoStdout: false
  });
  if (tap.exitCode !== 0) {
    throw new Error(`TAP timing run failed with exit code ${tap.exitCode}`);
  }

  const tapText = await fs.readFile(path.join(repoRoot, 'tests', 'perf', tapLogRel), 'utf8');
  const allTimings = parseNodeTapDurations(tapText);
  const installerTimings = allTimings.filter(isInstallerTiming);

  const fastestPercent = 20;
  const installerFast20 = computeFastestPercent(installerTimings, fastestPercent);
  const smokeIds = installerFast20.map(t => t.id);

  const snapshot = {
    kind: 'baseline',
    timestampUtc: ts,
    nodeVersion,
    npmVersion,
    commands: {
      raw: 'npm test',
      tap: 'npx tsx --test --test-reporter=tap --test-concurrency=1 <all test files>'
    },
    totals: {
      npmTestWallTimeMs: Math.round(raw.wallTimeMs),
      tapWallTimeMs: Math.round(tap.wallTimeMs)
    },
    artifacts: {
      rawLog: `tests/perf/${rawLogRel}`,
      tapLog: `tests/perf/${tapLogRel}`
    },
    timings: {
      countAll: allTimings.length,
      countInstaller: installerTimings.length,
      fastestPercent,
      smokeCount: smokeIds.length,
      installerSmokeIds: smokeIds,
      installer: installerTimings
    }
  } as const;

  const jsonRel = `baseline-${ts}.json`;
  const mdRel = `baseline-${ts}.md`;
  const smokeRel = `smoke-fast${fastestPercent}-${ts}.json`;

  await writeBoth(jsonRel, JSON.stringify(snapshot, null, 2) + '\n');
  await writeBoth(
    smokeRel,
    JSON.stringify(
      {
        kind: 'smoke-freeze',
        source: `baseline-${ts}.json`,
        fastestPercent,
        ids: smokeIds
      },
      null,
      2
    ) + '\n'
  );

  const md = [
    `## Baseline snapshot (${ts})`,
    ``,
    `- **Node**: ${nodeVersion}`,
    `- **npm**: ${npmVersion}`,
    `- **Raw runner**: \`npm test\``,
    `- **Raw wall time**: ${Math.round(raw.wallTimeMs)} ms`,
    `- **TAP wall time**: ${Math.round(tap.wallTimeMs)} ms`,
    `- **Parsed timings**: ${allTimings.length} test timing entries`,
    `- **Installer timings**: ${installerTimings.length} timing entries`,
    `- **Smoke freeze (fastest ${fastestPercent}%)**: ${smokeIds.length} tests`,
    ``,
    `Artifacts (duplicated in \`tests/perf/\` and \`projects/devduck/tests/perf/\`):`,
    `- \`${rawLogRel}\``,
    `- \`${tapLogRel}\``,
    `- \`${jsonRel}\``,
    `- \`${smokeRel}\``,
    ``
  ].join('\n');
  await writeBoth(mdRel, md);

  // Mirror raw logs too (for the requested path).
  await mirrorPerfArtifact(rawLogRel);
  await mirrorPerfArtifact(tapLogRel);

  // eslint-disable-next-line no-console
  console.log(`Baseline captured: tests/perf/${jsonRel}`);
}

// Node ESM entrypoint
main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

