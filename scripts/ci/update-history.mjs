#!/usr/bin/env node
/**
 * Updates `.cache/metrics/history.json` by appending `.cache/metrics/current.json`.
 * Keeps last N entries (default 200).
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

async function main() {
  const dir = readArg('--dir') ?? '.cache/metrics';
  const limitStr = readArg('--limit') ?? '200';
  const limit = Math.max(1, Number.parseInt(limitStr, 10) || 200);

  const currentPath = path.join(dir, 'current.json');
  const historyPath = path.join(dir, 'history.json');

  const current = await readJsonOr(currentPath, undefined);
  if (!current) {
    process.stderr.write(`Missing current metrics at ${currentPath}\n`);
    process.exit(2);
  }

  const history = await readJsonOr(historyPath, []);
  const next = Array.isArray(history) ? history : [];
  next.push(current);

  const sliced = next.length > limit ? next.slice(-limit) : next;
  await fsp.writeFile(historyPath, JSON.stringify(sliced, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log('[metrics] history wrote', historyPath, `(records=${sliced.length}, limit=${limit})`);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

