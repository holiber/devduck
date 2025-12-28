#!/usr/bin/env node
/**
 * Runs a shell command, logs output, and records timing/exit code into JSON.
 *
 * This is used in CI to ensure tests run only once while still producing metrics.
 *
 * Usage:
 *   node scripts/ci/run-and-record.mjs \
 *     --name npm_test \
 *     --cmd "npm test" \
 *     --log .cache/logs/npm-test.log \
 *     --out .cache/metrics/test-commands.json
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function readArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function readJsonIfExists(p) {
  try {
    const raw = await fsp.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const name = readArg('--name');
  const cmd = readArg('--cmd');
  const logPath = readArg('--log');
  const outPath = readArg('--out');
  const allowFailure = (readArg('--allow-failure') ?? '0') === '1';

  if (!name || !cmd || !logPath || !outPath) {
    process.stderr.write(
      'Usage: node scripts/ci/run-and-record.mjs --name <key> --cmd <command> --log <logPath> --out <jsonPath> [--allow-failure 1]\n'
    );
    process.exit(2);
  }

  await mkdirp(path.dirname(logPath));
  await mkdirp(path.dirname(outPath));

  const out = fs.createWriteStream(logPath, { flags: 'a' });
  out.write(`[${nowIso()}] $ ${cmd}\n`);

  const start = Date.now();
  const child = spawn(cmd, { shell: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout?.on('data', (c) => {
    out.write(c);
    process.stdout.write(c);
  });
  child.stderr?.on('data', (c) => {
    out.write(c);
    process.stderr.write(c);
  });

  const code = await new Promise((resolve) => child.on('close', resolve));
  const durationMs = Date.now() - start;
  out.write(`\n[${nowIso()}] exit=${code ?? 'null'} durationMs=${durationMs}\n`);
  out.end();

  const existing = (await readJsonIfExists(outPath)) ?? {};
  existing[name] = {
    name,
    command: cmd,
    exitCode: code,
    durationMs,
    collectedAt: nowIso()
  };
  await fsp.writeFile(outPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

  if (!allowFailure && code !== 0) process.exit(code ?? 1);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exit(1);
});

