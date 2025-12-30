#!/usr/bin/env node
/**
 * Builds baseline perf artifacts from already-captured raw outputs.
 *
 * Outputs (written into --snapshot-dir):
 * - node-test.all.timings.json
 * - node-test.installer.timings.json
 * - installer.fastest20.json (frozen fastest 20% list)
 * - baseline.md
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseNodeTestOutput, type ParsedNodeTestReport } from './node-test-parse.js';

type FastestEntry = {
  fullTitle: string;
  durationMs: number;
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args.set(a, argv[i + 1] ?? '');
      i++;
    }
  }
  return {
    snapshotDir: args.get('--snapshot-dir'),
    allRaw: args.get('--all-raw'),
    installerRaw: args.get('--installer-raw')
  };
}

async function readNumberIfExists(filePath: string): Promise<number | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const n = Number.parseFloat(raw.trim());
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function computeFastest20(installer: ParsedNodeTestReport): FastestEntry[] {
  const passed = installer.testCases.filter((t) => t.status === 'passed');
  const n = passed.length;
  const take = Math.max(1, Math.ceil(n * 0.2));
  return [...passed]
    .sort((a, b) => a.durationMs - b.durationMs)
    .slice(0, take)
    .map((t) => ({ fullTitle: t.fullTitle, durationMs: t.durationMs }));
}

function formatMs(ms: number | undefined): string {
  if (ms == null) return 'n/a';
  if (!Number.isFinite(ms)) return 'n/a';
  return `${ms.toFixed(0)}ms`;
}

async function main() {
  const { snapshotDir, allRaw, installerRaw } = parseArgs(process.argv.slice(2));
  if (!snapshotDir || !allRaw || !installerRaw) {
    console.error(
      [
        'Usage:',
        '  tsx scripts/perf/build-baseline-snapshot.ts \\',
        '    --snapshot-dir <projects/.../perf/<ts>> \\',
        '    --all-raw <npm-test.raw.txt> \\',
        '    --installer-raw <installer-only.raw.txt>'
      ].join('\n')
    );
    process.exit(2);
  }

  const snapshotAbs = path.resolve(snapshotDir);
  const allRawAbs = path.resolve(allRaw);
  const installerRawAbs = path.resolve(installerRaw);

  const [allRawText, installerRawText] = await Promise.all([
    readFile(allRawAbs, 'utf8'),
    readFile(installerRawAbs, 'utf8')
  ]);

  const allParsed = parseNodeTestOutput(allRawText, allRawAbs);
  const installerParsed = parseNodeTestOutput(installerRawText, installerRawAbs);

  const fastest20 = computeFastest20(installerParsed);

  const allDurationMeasured = await readNumberIfExists(path.join(snapshotAbs, 'npm-test.duration_ms'));
  const installerDurationMeasured = await readNumberIfExists(
    path.join(snapshotAbs, 'installer-only.duration_ms')
  );

  await writeFile(
    path.join(snapshotAbs, 'node-test.all.timings.json'),
    JSON.stringify(allParsed, null, 2) + '\n',
    'utf8'
  );
  await writeFile(
    path.join(snapshotAbs, 'node-test.installer.timings.json'),
    JSON.stringify(installerParsed, null, 2) + '\n',
    'utf8'
  );
  await writeFile(
    path.join(snapshotAbs, 'installer.fastest20.json'),
    JSON.stringify(
      {
        source: {
          snapshotDir: snapshotAbs,
          installerRaw: installerRawAbs
        },
        strategy: 'fastest 20% by durationMs (passed tests only)',
        count: fastest20.length,
        items: fastest20
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  const md = [
    '## Baseline (pre-migration)',
    '',
    `- **All tests (current runner)**: measured=${formatMs(allDurationMeasured)}; reported=${
      allParsed.totals.durationMsReported != null ? `${allParsed.totals.durationMsReported.toFixed(3)}ms` : 'n/a'
    }`,
    `- **Installer-only (current runner)**: measured=${formatMs(installerDurationMeasured)}; reported=${
      installerParsed.totals.durationMsReported != null
        ? `${installerParsed.totals.durationMsReported.toFixed(3)}ms`
        : 'n/a'
    }`,
    '',
    '### Fastest 20% (installer-only)',
    '',
    `Frozen list: \`installer.fastest20.json\` (count=${fastest20.length}).`,
    '',
    'Top entries (sorted):',
    ...fastest20.slice(0, 10).map((t) => `- ${t.durationMs.toFixed(3)}ms — ${t.fullTitle}`),
    fastest20.length > 10 ? '- ...' : ''
  ]
    .filter(Boolean)
    .join('\n');

  await writeFile(path.join(snapshotAbs, 'baseline.md'), md + '\n', 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

export { main };

