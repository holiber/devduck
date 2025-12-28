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

function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function fmtDeltaInt(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmtInt(n)}`;
}

function runUrl() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!repo || !runId) return undefined;
  return `${server}/${repo}/actions/runs/${runId}`;
}

function defaultPagesDashboardUrl() {
  const repo = process.env.GITHUB_REPOSITORY; // "owner/name"
  if (!repo || !repo.includes('/')) return undefined;
  const [owner, name] = repo.split('/');
  if (!owner || !name) return undefined;
  return `https://${owner}.github.io/${name}/metrics/`;
}

async function main() {
  const dir = readArg('--dir') ?? '.cache/metrics';
  const outPath = readArg('--out') ?? path.join(dir, 'pr-comment.md');

  const current = await readJsonOr(path.join(dir, 'current.json'), {});
  const diff = await readJsonOr(path.join(dir, 'diff.json'), { deltas: {} });

  const pr = current?.pr ?? {};
  const deltas = diff?.deltas ?? {};
  const url = runUrl();

  const dashboardUrl = process.env.METRICS_DASHBOARD_URL ?? defaultPagesDashboardUrl();
  const isPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request';

  const lines = [];
  lines.push('### 🧠 CI Metrics Dashboard');
  if (pr.number != null) lines.push(`- **PR**: #${pr.number}${pr.title ? ` — ${pr.title}` : ''}`);
  if (pr.additions != null || pr.deletions != null) {
    lines.push(`- **Δ Code**: +${pr.additions ?? 'n/a'} / -${pr.deletions ?? 'n/a'} (files: ${pr.changed_files ?? 'n/a'})`);
  }
  if (url) lines.push(`- **Workflow run**: ${url}`);
  lines.push('');
  lines.push('| Metric | Current | Δ vs main |');
  lines.push('| --- | ---: | ---: |');

  lines.push(`| 🏗 Build time | ${fmtMs(current?.commands?.build?.durationMs)} | ${fmtDeltaMs(deltas.build_duration_ms)} |`);
  lines.push(`| ⚡ Dev ready | ${fmtMs(current?.commands?.dev_start?.readyAtMs)} | ${fmtDeltaMs(deltas.dev_ready_ms)} |`);
  lines.push(`| 📦 npm pack size | ${fmtBytes(current?.sizes?.npm_pack?.bytes)} | ${fmtDeltaBytes(deltas.npm_pack_bytes)} |`);
  lines.push(`| 🗂 dist size | ${fmtBytes(current?.sizes?.dist?.bytes)} | ${fmtDeltaBytes(deltas.dist_bytes)} |`);
  lines.push(`| 🧾 Script code lines | ${fmtInt(current?.code?.scriptCodeLines)} | ${fmtDeltaInt(deltas.script_code_lines)} |`);
  lines.push(`| 📚 Total text lines | ${fmtInt(current?.code?.totalTextLines)} | ${fmtDeltaInt(deltas.total_text_lines)} |`);
  lines.push(`| 📜 Huge scripts (>1000 LOC) | ${fmtInt(current?.code?.hugeScripts)} | ${fmtDeltaInt(deltas.huge_scripts)} |`);
  lines.push(`| 🎲 Flaky tests (retried) | ${fmtInt(current?.tests?.flaky?.count)} | ${fmtDeltaInt(deltas.flaky_tests)} |`);
  lines.push(
    `| 🧪 Unit tests | ${current?.tests?.unit?.total ?? 'n/a'} tests / ${fmtMs(current?.tests?.unit?.reportedDurationMs ?? current?.tests?.unit?.durationMs)} | — |`
  );
  lines.push(
    `| 🧪 E2E (installer) | ${current?.tests?.e2e_installer?.total ?? 'n/a'} tests / ${fmtMs(
      current?.tests?.e2e_installer?.reportedDurationMs ?? current?.tests?.e2e_installer?.durationMs
    )} | — |`
  );
  lines.push('');
  if (dashboardUrl) {
    if (isPullRequest) {
      lines.push(`- **Dashboard (GitHub Pages)**: ${dashboardUrl} (published after merge to \`main\`)`);
    } else {
      lines.push(`- **Dashboard (history + charts)**: ${dashboardUrl}`);
    }
  }
  if (url) {
    lines.push(`- **Artifacts**: available on the workflow run page (download \`ci-metrics-artifacts\`).`);
  } else {
    lines.push('- **Artifacts**: logs + Playwright screenshots/video/trace/report + raw metrics JSON are attached to this workflow run.');
  }
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

