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

function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return 'n/a';
  return `${p.toFixed(2)}%`;
}

function fmtDeltaPct(p) {
  if (p == null || !Number.isFinite(p)) return 'n/a';
  const sign = p > 0 ? '+' : '';
  return `${sign}${fmtPct(p)}`;
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

async function probeDashboardUrl(url) {
  if (!url) return { ok: null, status: null };

  // Keep this fast and unauthenticated: the dashboard is expected to be public on GitHub Pages.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'devduck-ci' },
    });

    // Treat 2xx/3xx as reachable.
    if (res.status >= 200 && res.status < 400) return { ok: true, status: res.status };
    if (res.status === 404) return { ok: false, status: 404 };
    return { ok: null, status: res.status };
  } catch {
    return { ok: null, status: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const dir = readArg('--dir') ?? '.cache/metrics';
  const outPath = readArg('--out') ?? path.join(dir, 'pr-comment.md');

  const current = await readJsonOr(path.join(dir, 'current.json'), {});
  const diff = await readJsonOr(path.join(dir, 'diff.json'), { deltas: {} });

  const pr = current?.pr ?? {};
  const deltas = diff?.deltas ?? {};
  const url = runUrl();

  const defaultDashboardUrl = defaultPagesDashboardUrl();
  const dashboardUrl = process.env.METRICS_DASHBOARD_URL ?? defaultDashboardUrl;
  const isPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request';
  const shouldCheckGithubPages = Boolean(dashboardUrl && defaultDashboardUrl && dashboardUrl === defaultDashboardUrl);
  const dashboardProbe = shouldCheckGithubPages ? await probeDashboardUrl(dashboardUrl) : { ok: null, status: null };

  const lines = [];
  lines.push('### 🧠 CI Metrics Dashboard');
  // PR title/number and code diff are already visible on the PR page; avoid duplicating it in the comment.
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
  lines.push(`| 🧪 Coverage (lines) | ${fmtPct(current?.quality?.coverage?.linesPct)} | ${fmtDeltaPct(deltas.coverage_lines_pct)} |`);
  lines.push(`| 🐢 Slow tests (>20s) | ${fmtInt(current?.quality?.slowTests?.count)} | ${fmtDeltaInt(deltas.slow_tests_over_20s)} |`);
  lines.push(`| 🧬 Duplication (copy/paste) | ${fmtPct(current?.quality?.duplication?.duplicatedPct)} | ${fmtDeltaPct(deltas.duplication_pct)} |`);
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
      if (dashboardProbe.ok === false) {
        // GitHub supports "admonitions" in Markdown; CAUTION renders red.
        lines.push('');
        lines.push('> [!CAUTION]');
        lines.push(
          '> The GitHub Pages dashboard URL returned **HTTP 404**, so this link may not work. Verify GitHub Pages is enabled and the dashboard is deployed.'
        );
        lines.push('');
      } else if (shouldCheckGithubPages && dashboardProbe.ok == null) {
        // We couldn't verify the URL (network, rate limit, transient errors).
        lines.push('');
        lines.push('> [!WARNING]');
        lines.push(
          `> Unable to verify GitHub Pages dashboard URL${dashboardProbe.status ? ` (HTTP ${dashboardProbe.status})` : ''}. This link may be unavailable.`
        );
        lines.push('');
      }
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

