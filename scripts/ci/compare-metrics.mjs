#!/usr/bin/env node
/**
 * Compares `.cache/metrics/current.json` with `.cache/metrics/baseline.json`
 * and writes `.cache/metrics/diff.json`.
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

function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

function delta(cur, base) {
  if (cur == null) return undefined;
  return (cur ?? 0) - (base ?? 0);
}

async function main() {
  const dir = readArg('--dir') ?? '.cache/metrics';
  const currentPath = path.join(dir, 'current.json');
  const baselinePath = readArg('--baseline') ?? path.join(dir, 'baseline.json');
  const outPath = path.join(dir, 'diff.json');

  const cur = await readJsonOr(currentPath, {});
  const base = await readJsonOr(baselinePath, {});

  const out = {
    meta: {
      comparedAt: new Date().toISOString(),
      currentSha: cur?.meta?.sha,
      baselineSha: base?.meta?.sha
    },
    deltas: {
      build_duration_ms: delta(num(cur?.commands?.build?.durationMs), num(base?.commands?.build?.durationMs)),
      dev_ready_ms: delta(num(cur?.commands?.dev_start?.readyAtMs), num(base?.commands?.dev_start?.readyAtMs)),
      npm_pack_bytes: delta(num(cur?.sizes?.npm_pack?.bytes), num(base?.sizes?.npm_pack?.bytes)),
      dist_bytes: delta(num(cur?.sizes?.dist?.bytes), num(base?.sizes?.dist?.bytes)),
      build_output_bytes: delta(num(cur?.sizes?.build_output_dir?.bytes), num(base?.sizes?.build_output_dir?.bytes))
    }
  };

  await fsp.writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log('[metrics] diff wrote', outPath);
  // eslint-disable-next-line no-console
  console.log(
    '[metrics] deltas:',
    'build',
    out.deltas.build_duration_ms ?? 'n/a',
    'ms;',
    'devReady',
    out.deltas.dev_ready_ms ?? 'n/a',
    'ms;',
    'npm_pack',
    out.deltas.npm_pack_bytes ?? 'n/a',
    'bytes'
  );
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

