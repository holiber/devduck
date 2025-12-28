#!/usr/bin/env node
/**
 * Fails the current process if recorded test commands contain failures.
 *
 * Usage:
 *   node scripts/ci/assert-tests-passed.mjs --file .cache/metrics/test-commands.json --require npm_test --require pw_installer
 */
import fsp from 'node:fs/promises';

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

async function main() {
  const file = readArg('--file') ?? '.cache/metrics/test-commands.json';
  const required = readArgs('--require');

  let data;
  try {
    data = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    process.stderr.write(`[tests] missing or invalid ${file}\n`);
    process.exit(2);
  }

  const failures = [];

  for (const name of required) {
    const rec = data?.[name];
    if (!rec) failures.push({ name, reason: 'missing' });
    else if (rec.exitCode !== 0) failures.push({ name, reason: `exit ${rec.exitCode}` });
  }

  for (const [name, rec] of Object.entries(data ?? {})) {
    if (rec && typeof rec === 'object' && 'exitCode' in rec && rec.exitCode !== 0) {
      // Only report non-required failures once.
      if (!required.includes(name)) failures.push({ name, reason: `exit ${rec.exitCode}` });
    }
  }

  if (failures.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[tests] all recorded commands passed');
    return;
  }

  process.stderr.write('[tests] failures detected:\n');
  for (const f of failures) process.stderr.write(`- ${f.name}: ${f.reason}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});

