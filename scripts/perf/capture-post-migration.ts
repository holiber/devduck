#!/usr/bin/env node
/**
 * Capture post-migration timings:
 * - Node.js test runner (`npm test`) for remaining (non-installer) tests
 * - Playwright installer suite
 * - Playwright smoke group (grep @smoke)
 *
 * Writes artifacts under `tests/perf/` and mirrors under `projects/devduck/tests/perf/`.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, readdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseNodeTapDurations } from './tap-timings.js';
import { parsePlaywrightListTimings } from './playwright-list-timings.js';

type CmdResult = { exitCode: number; wallTimeMs: number };

function utcTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function runAndCapture(opts: {
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  alsoStdout?: boolean;
}): Promise<CmdResult> {
  const { command, args, cwd, logPath, alsoStdout } = opts;
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(logPath, { flags: 'w' });
    child.stdout?.on('data', (c: Buffer) => {
      out.write(c);
      if (alsoStdout) process.stdout.write(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      out.write(c);
      if (alsoStdout) process.stderr.write(c);
    });
    child.on('error', err => {
      out.end();
      reject(err);
    });
    child.on('close', code => {
      out.end();
      resolve({ exitCode: code ?? 1, wallTimeMs: performance.now() - start });
    });
  });
}

function findTestFiles(dir: string, acc: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findTestFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

async function writeBoth(relPath: string, content: string | Buffer) {
  const outA = path.join(process.cwd(), 'tests', 'perf', relPath);
  const outB = path.join(process.cwd(), 'projects', 'devduck', 'tests', 'perf', relPath);
  await ensureDir(path.dirname(outA));
  await ensureDir(path.dirname(outB));
  await fs.writeFile(outA, content);
  await fs.writeFile(outB, content);
}

async function main() {
  const postTs = utcTimestamp();
  const baselineTs = process.argv[2] || '2025-12-28T01-30-23Z';
  const repoRoot = process.cwd();

  await ensureDir(path.join(repoRoot, 'tests', 'perf'));
  await ensureDir(path.join(repoRoot, 'projects', 'devduck', 'tests', 'perf'));

  // Node tests (remaining)
  const npmLogRel = `post-${postTs}-npm-test.log`;
  const npmRes = await runAndCapture({
    command: 'npm',
    args: ['test'],
    cwd: repoRoot,
    logPath: path.join(repoRoot, 'tests', 'perf', npmLogRel),
    alsoStdout: true
  });
  if (npmRes.exitCode !== 0) throw new Error(`npm test failed (exit ${npmRes.exitCode})`);
  await writeBoth(npmLogRel, await fs.readFile(path.join(repoRoot, 'tests', 'perf', npmLogRel)));

  const tapLogRel = `post-${postTs}-tap.log`;
  const testFiles = findTestFiles(path.join(repoRoot, 'tests'));
  const tapRes = await runAndCapture({
    command: 'npx',
    args: ['tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...testFiles],
    cwd: repoRoot,
    logPath: path.join(repoRoot, 'tests', 'perf', tapLogRel),
    alsoStdout: false
  });
  if (tapRes.exitCode !== 0) throw new Error(`TAP run failed (exit ${tapRes.exitCode})`);
  await writeBoth(tapLogRel, await fs.readFile(path.join(repoRoot, 'tests', 'perf', tapLogRel)));

  const tapText = await fs.readFile(path.join(repoRoot, 'tests', 'perf', tapLogRel), 'utf8');
  const nodeTimings = parseNodeTapDurations(tapText);

  // Playwright installer suite
  const pwInstallerLogRel = `post-${postTs}-pw-installer.log`;
  const pwInstallerRes = await runAndCapture({
    command: 'npx',
    args: ['playwright', 'test', '-c', 'playwright.config.ts', '--reporter=list'],
    cwd: repoRoot,
    logPath: path.join(repoRoot, 'tests', 'perf', pwInstallerLogRel),
    alsoStdout: false
  });
  if (pwInstallerRes.exitCode !== 0) throw new Error(`Playwright installer suite failed (exit ${pwInstallerRes.exitCode})`);
  await writeBoth(pwInstallerLogRel, await fs.readFile(path.join(repoRoot, 'tests', 'perf', pwInstallerLogRel)));

  const pwInstallerText = await fs.readFile(path.join(repoRoot, 'tests', 'perf', pwInstallerLogRel), 'utf8');
  const pwInstallerTimings = parsePlaywrightListTimings(pwInstallerText);

  // Playwright smoke group
  const pwSmokeLogRel = `post-${postTs}-pw-smoke.log`;
  const pwSmokeRes = await runAndCapture({
    command: 'npx',
    args: ['playwright', 'test', '-c', 'playwright.config.ts', '--grep', '@smoke', '--reporter=list'],
    cwd: repoRoot,
    logPath: path.join(repoRoot, 'tests', 'perf', pwSmokeLogRel),
    alsoStdout: false
  });
  if (pwSmokeRes.exitCode !== 0) throw new Error(`Playwright smoke group failed (exit ${pwSmokeRes.exitCode})`);
  await writeBoth(pwSmokeLogRel, await fs.readFile(path.join(repoRoot, 'tests', 'perf', pwSmokeLogRel)));

  const pwSmokeText = await fs.readFile(path.join(repoRoot, 'tests', 'perf', pwSmokeLogRel), 'utf8');
  const pwSmokeTimings = parsePlaywrightListTimings(pwSmokeText);

  const postJsonRel = `post-${postTs}.json`;
  const snapshot = {
    kind: 'post-migration',
    timestampUtc: postTs,
    baselineTimestampUtc: baselineTs,
    totals: {
      nodeNpmTestWallTimeMs: Math.round(npmRes.wallTimeMs),
      nodeTapWallTimeMs: Math.round(tapRes.wallTimeMs),
      playwrightInstallerWallTimeMs: Math.round(pwInstallerRes.wallTimeMs),
      playwrightSmokeWallTimeMs: Math.round(pwSmokeRes.wallTimeMs)
    },
    artifacts: {
      npmLog: `tests/perf/${npmLogRel}`,
      tapLog: `tests/perf/${tapLogRel}`,
      playwrightInstallerLog: `tests/perf/${pwInstallerLogRel}`,
      playwrightSmokeLog: `tests/perf/${pwSmokeLogRel}`
    },
    timings: {
      nodeTap: nodeTimings,
      playwrightInstaller: pwInstallerTimings,
      playwrightSmoke: pwSmokeTimings
    }
  } as const;

  await writeBoth(postJsonRel, JSON.stringify(snapshot, null, 2) + '\n');

  // Comparison report (short)
  const baselinePath = path.join(repoRoot, 'tests', 'perf', `baseline-${baselineTs}.json`);
  let baseline: any = null;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch {
    // ignore
  }

  const compareRel = `compare-baseline-${baselineTs}-to-${postTs}.md`;
  const md = [
    `## Perf comparison`,
    ``,
    `- **Baseline**: \`baseline-${baselineTs}.json\``,
    `- **Post-migration**: \`${postJsonRel}\``,
    ``,
    `### Totals (wall time)`,
    ``,
    `| Suite | Baseline | Post-migration |`,
    `| --- | ---: | ---: |`,
    `| Node runner (npm test) | ${baseline?.totals?.npmTestWallTimeMs ?? 'n/a'} ms | ${snapshot.totals.nodeNpmTestWallTimeMs} ms |`,
    `| Playwright installer suite | n/a | ${snapshot.totals.playwrightInstallerWallTimeMs} ms |`,
    `| Playwright smoke (@smoke) | n/a | ${snapshot.totals.playwrightSmokeWallTimeMs} ms |`,
    ``,
    `### Notes`,
    ``,
    `- Baseline Playwright timings are intentionally not present (Playwright suite didn't exist yet).`,
    `- Smoke group source-of-truth: \`tests/perf/smoke-fast20-${baselineTs}.json\` (mirrored under \`projects/devduck/tests/perf/\`).`,
    ``
  ].join('\n');

  await writeBoth(compareRel, md);

  // eslint-disable-next-line no-console
  console.log(`Post-migration perf captured: tests/perf/${postJsonRel}`);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

