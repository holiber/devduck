#!/usr/bin/env node
/**
 * Renders a PR comment Markdown from `.cache/metrics/metrics.json`.
 *
 * Usage:
 *   node scripts/ci/render-pr-comment.mjs --metrics .cache/metrics/metrics.json --out .cache/metrics/pr-comment.md
 */
import fs from 'node:fs/promises';
import path from 'node:path';

function readArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  if (ms >= 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
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

function linkToRun() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!repo || !runId) return undefined;
  return `${server}/${repo}/actions/runs/${runId}`;
}

async function main() {
  const metricsPath = readArg('--metrics') ?? '.cache/metrics/metrics.json';
  const outPath = readArg('--out') ?? '.cache/metrics/pr-comment.md';

  const raw = await fs.readFile(metricsPath, 'utf8');
  const data = JSON.parse(raw);

  const pr = data.pr ?? {};
  const cmd = data.commands ?? {};
  const sizes = data.sizes ?? {};
  const notes = Array.isArray(data.notes) ? data.notes : [];

  const runUrl = linkToRun();

  const lines = [];
  lines.push('### 🧪 PR Metrics & Artifacts');
  lines.push('');
  if (pr.number != null) lines.push(`- **PR**: #${pr.number}${pr.title ? ` — ${pr.title}` : ''}`);
  if (pr.additions != null || pr.deletions != null) {
    lines.push(`- **Δ Code**: +${pr.additions ?? 'n/a'} / -${pr.deletions ?? 'n/a'} (files: ${pr.changed_files ?? 'n/a'})`);
  }
  lines.push(`- **Node**: ${data.meta?.node ?? 'n/a'}`);
  if (runUrl) lines.push(`- **Workflow run**: ${runUrl}`);
  lines.push('');

  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| npm ci | ${fmtMs(cmd.npm_ci?.durationMs)} (exit ${cmd.npm_ci?.exitCode ?? 'n/a'}) |`);
  lines.push(`| tests (npm test) | ${fmtMs(cmd.tests?.durationMs)} (exit ${cmd.tests?.exitCode ?? 'n/a'}) |`);
  if (cmd.build) lines.push(`| build | ${fmtMs(cmd.build?.durationMs)} (exit ${cmd.build?.exitCode ?? 'n/a'}) |`);
  if (cmd.dev_start) {
    lines.push(
      `| dev start | ${fmtMs(cmd.dev_start?.durationMs)} (ready: ${fmtMs(cmd.dev_start?.readyAtMs)}; exit ${cmd.dev_start?.exitCode ?? 'n/a'}) |`
    );
  }
  if (cmd.pw_installer) {
    lines.push(
      `| Playwright (installer) | ${fmtMs(cmd.pw_installer?.durationMs)} (exit ${cmd.pw_installer?.exitCode ?? 'n/a'}) |`
    );
  }
  if (cmd.pw_smoke) {
    lines.push(`| Playwright (smoke) | ${fmtMs(cmd.pw_smoke?.durationMs)} (exit ${cmd.pw_smoke?.exitCode ?? 'n/a'}) |`);
  }
  lines.push(`| dist size | ${fmtBytes(sizes.dist?.bytes)} |`);
  lines.push(`| npm pack size | ${fmtBytes(sizes.npm_pack?.bytes)} |`);
  if (sizes.build_output_dir) lines.push(`| build output size | ${fmtBytes(sizes.build_output_dir?.bytes)} |`);
  lines.push('');
  lines.push('_Artifacts uploaded: `.cache/logs`, `.cache/metrics`, `.cache/playwright` (screenshots/video/trace/report), `.cache/ai_logs`._');
  if (notes.length > 0) {
    lines.push('');
    lines.push('**Notes**:');
    for (const n of notes) lines.push(`- ${n}`);
  }
  lines.push('');

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join('\n'), 'utf8');
}

main().catch((err) => {
  // Best-effort: do not fail PR comment job.
  // The main CI test workflow is responsible for strict failures.
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

