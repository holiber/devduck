#!/usr/bin/env node
/**
 * Derive installer timings + fastest 20% smoke list from an existing Node TAP log.
 *
 * This is useful when the raw baseline run has already been captured, but we want
 * to (re)compute installer-only timings and the frozen smoke group from the TAP output.
 *
 * Usage:
 *   npx tsx scripts/perf/derive-installer-fast20-from-tap.ts 2025-12-28T01-30-23Z
 */

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseNodeTapDurations, type TapTestTiming } from './tap-timings.js';

function getStdout(command: string, args: string[], cwd: string): string {
  const res = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) return 'unknown';
  return (res.stdout ?? '').toString().trim();
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

function computeFastestPercent(timings: TapTestTiming[], percent: number): TapTestTiming[] {
  if (timings.length === 0) return [];
  const p = Math.max(0, Math.min(100, percent));
  const k = Math.max(1, Math.ceil((timings.length * p) / 100));
  return [...timings].sort((a, b) => a.durationMs - b.durationMs).slice(0, k);
}

async function writeBoth(relPath: string, content: string | Buffer) {
  const outA = path.join(process.cwd(), 'tests', 'perf', relPath);
  const outB = path.join(process.cwd(), 'projects', 'devduck', 'tests', 'perf', relPath);
  await fs.mkdir(path.dirname(outA), { recursive: true });
  await fs.mkdir(path.dirname(outB), { recursive: true });
  await fs.writeFile(outA, content);
  await fs.writeFile(outB, content);
}

async function main() {
  const ts = process.argv[2];
  if (!ts) {
    throw new Error('Missing timestamp arg. Example: 2025-12-28T01-30-23Z');
  }

  const repoRoot = process.cwd();
  const nodeVersion = process.version;
  const npmVersion = getStdout('npm', ['--version'], repoRoot);

  const tapLogRel = `baseline-${ts}-tap.log`;
  const tapLogPath = path.join(repoRoot, 'tests', 'perf', tapLogRel);
  const tapText = await fs.readFile(tapLogPath, 'utf8');

  const allTimings = parseNodeTapDurations(tapText);
  const installerTimings = allTimings.filter(isInstallerTiming);

  const fastestPercent = 20;
  const installerFast20 = computeFastestPercent(installerTimings, fastestPercent);
  const smokeIds = installerFast20.map(t => t.id);

  // Keep totals/artifacts from the original baseline file if present.
  const baselineJsonRel = `baseline-${ts}.json`;
  const baselineJsonPath = path.join(repoRoot, 'tests', 'perf', baselineJsonRel);
  let prior: any = null;
  try {
    prior = JSON.parse(await fs.readFile(baselineJsonPath, 'utf8'));
  } catch {
    // ignore
  }

  const snapshot = {
    kind: 'baseline',
    timestampUtc: ts,
    nodeVersion: prior?.nodeVersion ?? nodeVersion,
    npmVersion: prior?.npmVersion ?? npmVersion,
    commands: prior?.commands ?? {
      raw: 'npm test',
      tap: 'npx tsx --test --test-reporter=tap --test-concurrency=1 <all test files>'
    },
    totals: prior?.totals ?? {},
    artifacts: prior?.artifacts ?? {
      rawLog: `tests/perf/baseline-${ts}-npm-test.log`,
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

  const smokeRel = `smoke-fast${fastestPercent}-${ts}.json`;
  const mdRel = `baseline-${ts}.md`;

  await writeBoth(baselineJsonRel, JSON.stringify(snapshot, null, 2) + '\n');
  await writeBoth(
    smokeRel,
    JSON.stringify({ kind: 'smoke-freeze', source: baselineJsonRel, fastestPercent, ids: smokeIds }, null, 2) + '\n'
  );

  const md = [
    `## Baseline snapshot (${ts})`,
    ``,
    `- **Node**: ${snapshot.nodeVersion}`,
    `- **npm**: ${snapshot.npmVersion}`,
    `- **Raw runner**: \`${snapshot.commands.raw}\``,
    snapshot.totals?.npmTestWallTimeMs ? `- **Raw wall time**: ${snapshot.totals.npmTestWallTimeMs} ms` : `- **Raw wall time**: (unknown)`,
    snapshot.totals?.tapWallTimeMs ? `- **TAP wall time**: ${snapshot.totals.tapWallTimeMs} ms` : `- **TAP wall time**: (unknown)`,
    `- **Parsed timings**: ${allTimings.length} test timing entries`,
    `- **Installer timings**: ${installerTimings.length} timing entries`,
    `- **Smoke freeze (fastest ${fastestPercent}%)**: ${smokeIds.length} tests`,
    ``,
    `Artifacts (duplicated in \`tests/perf/\` and \`projects/devduck/tests/perf/\`):`,
    `- \`baseline-${ts}-npm-test.log\``,
    `- \`${tapLogRel}\``,
    `- \`${baselineJsonRel}\``,
    `- \`${smokeRel}\``,
    ``
  ].join('\n');
  await writeBoth(mdRel, md);

  // eslint-disable-next-line no-console
  console.log(`Updated baseline installer timings: tests/perf/${baselineJsonRel}`);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

