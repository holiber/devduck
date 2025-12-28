#!/usr/bin/env node
/**
 * Merges multiple `test-commands.json` files produced by `run-and-record.mjs`
 * into a single output JSON file.
 *
 * Usage:
 *   node scripts/ci/merge-test-commands.mjs \
 *     --out .cache/metrics/test-commands.json \
 *     --in .cache/_jobs/unit/.cache/metrics/test-commands.json \
 *     --in .cache/_jobs/e2e/.cache/metrics/test-commands.json
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

function readArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readArgs(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name) out.push(process.argv[i + 1]);
  }
  return out.filter(Boolean);
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function main() {
  const outPath = readArg('--out') ?? '.cache/metrics/test-commands.json';
  const inputs = readArgs('--in');

  if (inputs.length === 0) {
    process.stderr.write('Usage: node scripts/ci/merge-test-commands.mjs --out <file> --in <file> [--in <file> ...]\n');
    process.exit(2);
  }

  /** @type {Record<string, any>} */
  const merged = {};
  let readCount = 0;

  for (const p of inputs) {
    const data = await readJsonIfExists(p);
    if (!data || typeof data !== 'object') continue;
    for (const [k, v] of Object.entries(data)) merged[k] = v;
    readCount += 1;
  }

  // Always write a file so downstream steps have a stable path.
  await mkdirp(path.dirname(outPath));
  await fsp.writeFile(outPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  if (readCount === 0) {
    process.stderr.write(`[tests] merge-test-commands: no readable input files; wrote empty ${outPath}\n`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[tests] merged ${readCount} file(s) into ${outPath}`);
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});

