#!/usr/bin/env node
/**
 * Updates `.cache/metrics/baseline.json` from `.cache/metrics/current.json`,
 * stamping baseline metadata for traceability:
 *   { commit: "<sha>", pr: 42, timestamp: "<ISO>" }
 *
 * This keeps baseline compatible with `compare-metrics.mjs` (full metrics object),
 * while adding a small `baseline` section at the root.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

function readArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readJsonOr(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function intOrZero(x) {
  const n = typeof x === 'number' ? x : Number.parseInt(String(x ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const dir = readArg('--dir') ?? '.cache/metrics';
  const currentPath = path.join(dir, 'current.json');
  const baselinePath = path.join(dir, 'baseline.json');

  const current = await readJsonOr(currentPath, undefined);
  if (!current || typeof current !== 'object') {
    process.stderr.write(`Missing current metrics at ${currentPath}\n`);
    process.exit(2);
  }

  const commit = String(current?.meta?.sha ?? process.env.GITHUB_SHA ?? '');
  const pr =
    intOrZero(current?.pr?.number) ||
    intOrZero(current?.meta?.prNumber) ||
    intOrZero(process.env.DEV_DUCK_PR_NUMBER) ||
    0;

  const timestamp = new Date().toISOString();

  const stamped = {
    ...current,
    commit,
    pr,
    timestamp,
    baseline: {
      commit,
      pr,
      timestamp
    }
  };

  await fsp.writeFile(baselinePath, JSON.stringify(stamped, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log('[metrics] baseline wrote', baselinePath, `(commit=${commit || 'n/a'}, pr=${pr})`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

