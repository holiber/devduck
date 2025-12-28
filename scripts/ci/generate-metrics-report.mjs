#!/usr/bin/env node
/**
 * Generates an HTML dashboard (Chart.js via CDN) from:
 * - `.cache/metrics/current.json`
 * - `.cache/metrics/diff.json`
 * - `.cache/metrics/history.json` (optional)
 *
 * Outputs:
 * - `<outDir>/metrics/index.html`
 * - copies JSON files into `<outDir>/metrics/` for easy debugging
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

function clsForDelta(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
}

async function writeFileEnsuringDir(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');
}

async function main() {
  const metricsDir = readArg('--metrics-dir') ?? '.cache/metrics';
  const outDir = readArg('--out-dir') ?? '.cache/metrics-pages';

  const current = await readJsonOr(path.join(metricsDir, 'current.json'), {});
  const diff = await readJsonOr(path.join(metricsDir, 'diff.json'), { deltas: {} });
  const history = await readJsonOr(path.join(metricsDir, 'history.json'), []);
  const compareBaseline = await readJsonOr(path.join(metricsDir, 'compare-baseline.json'), undefined);

  const buildMs = current?.commands?.build?.durationMs;
  const devReadyMs = current?.commands?.dev_start?.readyAtMs;
  const packBytes = current?.sizes?.npm_pack?.bytes;
  const distBytes = current?.sizes?.dist?.bytes;
  const outBytes = current?.sizes?.build_output_dir?.bytes;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Devduck Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;margin:40px;background:#fafafa;color:#111}
    h1{font-size:1.6rem;margin:0 0 8px}
    .sub{color:#444;margin:0 0 18px}
    .card{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.06);padding:16px 18px;margin:16px 0}
    table{border-collapse:collapse;width:100%}
    th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-size:14px}
    th{background:#f5f5f5}
    .pos{color:#c0392b}
    .neg{color:#27ae60}
    code{background:#f3f3f3;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <h1>Devduck Metrics Dashboard</h1>
  <p class="sub"><strong>Generated:</strong> ${new Date().toLocaleString()} &nbsp; <strong>SHA:</strong> <code>${current?.meta?.sha ?? 'n/a'}</code></p>

  <div class="card">
    <table>
      <thead>
        <tr><th>Metric</th><th>Current</th><th>Δ vs baseline</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>🏗 Build time</td>
          <td>${fmtMs(buildMs)}</td>
          <td class="${clsForDelta(diff?.deltas?.build_duration_ms)}">${fmtMs(diff?.deltas?.build_duration_ms)}</td>
        </tr>
        <tr>
          <td>⚡ Dev ready</td>
          <td>${fmtMs(devReadyMs)}</td>
          <td class="${clsForDelta(diff?.deltas?.dev_ready_ms)}">${fmtMs(diff?.deltas?.dev_ready_ms)}</td>
        </tr>
        <tr>
          <td>📦 Package size (npm pack)</td>
          <td>${fmtBytes(packBytes)}</td>
          <td class="${clsForDelta(diff?.deltas?.npm_pack_bytes)}">${fmtBytes(diff?.deltas?.npm_pack_bytes)}</td>
        </tr>
        <tr>
          <td>🗂 dist size</td>
          <td>${fmtBytes(distBytes)}</td>
          <td class="${clsForDelta(diff?.deltas?.dist_bytes)}">${fmtBytes(diff?.deltas?.dist_bytes)}</td>
        </tr>
        <tr>
          <td>🧱 build output size</td>
          <td>${fmtBytes(outBytes)}</td>
          <td class="${clsForDelta(diff?.deltas?.build_output_bytes)}">${fmtBytes(diff?.deltas?.build_output_bytes)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <canvas id="trend" height="120"></canvas>
  </div>

  <div class="card">
    <div><strong>Raw JSON:</strong>
      <a href="./current.json">current.json</a> ·
      <a href="./compare-baseline.json">compare-baseline.json</a> ·
      <a href="./baseline.json">baseline.json</a> ·
      <a href="./diff.json">diff.json</a> ·
      <a href="./history.json">history.json</a>
    </div>
  </div>

  <script>
    const history = ${JSON.stringify(Array.isArray(history) ? history : [])};
    const labels = history.map(h => (h?.meta?.collectedAt || h?.meta?.timestamp || h?.timestamp || '').toString().slice(0, 10));
    const build = history.map(h => (h?.commands?.build?.durationMs ?? null));
    const dev = history.map(h => (h?.commands?.dev_start?.readyAtMs ?? null));
    const pack = history.map(h => (h?.sizes?.npm_pack?.bytes ?? null));

    const ctx = document.getElementById('trend').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Build (ms)', data: build, borderColor: '#3498db', tension: 0.25, spanGaps: true },
          { label: 'Dev ready (ms)', data: dev, borderColor: '#9b59b6', tension: 0.25, spanGaps: true },
          { label: 'npm pack (bytes)', data: pack, borderColor: '#2ecc71', tension: 0.25, spanGaps: true, yAxisID: 'y2' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { type: 'linear', position: 'left', title: { display: true, text: 'ms' } },
          y2: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'bytes' } }
        }
      }
    });
  </script>
</body>
</html>`;

  const metricsOutDir = path.join(outDir, 'metrics');
  await fsp.mkdir(metricsOutDir, { recursive: true });
  await writeFileEnsuringDir(path.join(metricsOutDir, 'index.html'), html);

  // Copy JSON alongside HTML (so the dashboard is self-contained on Pages).
  const toCopy = ['current.json', 'baseline.json', 'compare-baseline.json', 'diff.json', 'history.json'];
  for (const f of toCopy) {
    const src = path.join(metricsDir, f);
    const dst = path.join(metricsOutDir, f);
    try {
      const raw = await fsp.readFile(src, 'utf8');
      await writeFileEnsuringDir(dst, raw);
    } catch {
      await writeFileEnsuringDir(dst, f === 'history.json' ? '[]\n' : '{}\n');
    }
  }

  // eslint-disable-next-line no-console
  console.log('[metrics] dashboard wrote', path.join(metricsOutDir, 'index.html'));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

