#!/usr/bin/env node
/**
 * Renders a PR comment Markdown from `.cache/metrics/current.json` + `diff.json`.
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

function fmtBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
}

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  if (ms >= 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function fmtDeltaMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const sign = ms > 0 ? '+' : '';
  return `${sign}${fmtMs(ms)}`;
}

function fmtDeltaBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return 'n/a';
  const sign = bytes > 0 ? '+' : '';
  return `${sign}${fmtBytes(bytes)}`;
}

function runUrl() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!repo || !runId) return undefined;
  return `${server}/${repo}/actions/runs/${runId}`;
}

async function main() {
  const dir = readArg('--dir') ?? '.cache/metrics';
  const outPath = readArg('--out') ?? path.join(dir, 'pr-comment.md');

  const current = await readJsonOr(path.join(dir, 'current.json'), {});
  const diff = await readJsonOr(path.join(dir, 'diff.json'), { deltas: {} });

  const pr = current?.pr ?? {};
  const deltas = diff?.deltas ?? {};
  const url = runUrl();

  const dashboardUrl =
    process.env.METRICS_DASHBOARD_URL ??
    'https://holiber.github.io/devduck/metrics/';

  const lines = [];
  lines.push('### 🧠 CI Metrics Dashboard');
  lines.push('');
  if (pr.number != null) lines.push(`- **PR**: #${pr.number}${pr.title ? ` — ${pr.title}` : ''}`);
  if (pr.additions != null || pr.deletions != null) {
    lines.push(`- **Δ Code**: +${pr.additions ?? 'n/a'} / -${pr.deletions ?? 'n/a'} (files: ${pr.changed_files ?? 'n/a'})`);
  }
  if (url) lines.push(`- **Workflow run**: ${url}`);
  lines.push('');
  lines.push('| Metric | Current | Δ vs main |');
  lines.push('| --- | ---: | ---: |');

  lines.push(`| Build time | ${fmtMs(current?.commands?.build?.durationMs)} | ${fmtDeltaMs(deltas.build_duration_ms)} |`);
  lines.push(`| Dev ready | ${fmtMs(current?.commands?.dev_start?.readyAtMs)} | ${fmtDeltaMs(deltas.dev_ready_ms)} |`);
  lines.push(`| npm pack size | ${fmtBytes(current?.sizes?.npm_pack?.bytes)} | ${fmtDeltaBytes(deltas.npm_pack_bytes)} |`);
  lines.push(`| dist size | ${fmtBytes(current?.sizes?.dist?.bytes)} | ${fmtDeltaBytes(deltas.dist_bytes)} |`);
  lines.push(
    `| Unit tests | ${current?.tests?.unit?.total ?? 'n/a'} tests / ${fmtMs(current?.tests?.unit?.reportedDurationMs ?? current?.tests?.unit?.durationMs)} | — |`
  );
  lines.push(
    `| E2E (installer) | ${current?.tests?.e2e_installer?.total ?? 'n/a'} tests / ${fmtMs(
      current?.tests?.e2e_installer?.reportedDurationMs ?? current?.tests?.e2e_installer?.durationMs
    )} | — |`
  );
  lines.push('');
  lines.push(`- **Dashboard (history + charts)**: ${dashboardUrl}`);
  lines.push('- **Artifacts**: logs + Playwright screenshots/video/trace/report + raw metrics JSON are attached to this workflow run.');
  lines.push('');
  lines.push('<!-- devduck-metrics-comment -->');
  lines.push('');

  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, lines.join('\n'), 'utf8');
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

