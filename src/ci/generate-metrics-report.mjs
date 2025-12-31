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

function escapeXml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function makeSimpleBadgeSvg({ label, message, labelColor, messageColor }) {
  // Minimal Shields-like badge, no external deps.
  const labelText = escapeXml(label);
  const msg = message == null ? '' : String(message);
  const msgText = escapeXml(msg);
  const hasMessage = msg.length > 0;

  // Approximate text widths (DejaVu Sans is close enough).
  const charW = 6.2;
  const pad = 10;
  const fontSize = 11;
  const height = 20;

  if (!hasMessage) {
    const width = Math.max(70, Math.round(label.length * charW + pad * 2));
    const x = Math.round(width / 2);
    const bg = labelColor || messageColor || '#0366d6';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${labelText}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${width}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${width}" height="${height}" fill="${bg}"/>
    <rect width="${width}" height="${height}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="${fontSize}">
    <text x="${x}" y="14">${labelText}</text>
  </g>
</svg>
`;
  }

  const labelW = Math.max(40, Math.round(label.length * charW + pad * 2));
  const msgW = Math.max(38, Math.round(msg.length * charW + pad * 2));
  const width = labelW + msgW;

  const labelX = Math.round(labelW / 2);
  const msgX = labelW + Math.round(msgW / 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${labelText}: ${msgText}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${width}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${height}" fill="${labelColor}"/>
    <rect x="${labelW}" width="${msgW}" height="${height}" fill="${messageColor}"/>
    <rect width="${width}" height="${height}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="${fontSize}">
    <text x="${labelX}" y="14">${labelText}</text>
    <text x="${msgX}" y="14">${msgText}</text>
  </g>
</svg>
`;
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

function fmtTestMs(ms) {
  // Test durations are stored in ms but displayed in seconds.
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const s = ms / 1000;
  const dp = s >= 100 ? 0 : s >= 10 ? 1 : 2;
  return `${s.toFixed(dp)}s`;
}

function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function fmtPct(p) {
  if (p == null || !Number.isFinite(p)) return 'n/a';
  return `${p.toFixed(2)}%`;
}

function fmtDeltaMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const sign = ms > 0 ? '+' : '';
  return `${sign}${fmtMs(ms)}`;
}

function fmtDeltaTestMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  const sign = ms > 0 ? '+' : '';
  return `${sign}${fmtTestMs(ms)}`;
}

function fmtThresholdMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'n/a';
  if (ms % 1000 === 0) return `${(ms / 1000).toFixed(0)}s`;
  return `${ms.toFixed(0)}ms`;
}

function fmtDeltaInt(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmtInt(n)}`;
}

function fmtTestDelta({ deltaTotal, deltaDurationMs }) {
  const parts = [];
  if (deltaTotal != null && Number.isFinite(deltaTotal)) parts.push(`${fmtDeltaInt(deltaTotal)} tests`);
  if (deltaDurationMs != null && Number.isFinite(deltaDurationMs)) parts.push(fmtDeltaTestMs(deltaDurationMs));
  if (parts.length === 0) return 'n/a';
  return parts.join(' / ');
}

function clsForDelta(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
}

function clsForDeltaInverted(n) {
  // For metrics where "higher is better" (e.g. coverage).
  if (n == null || !Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'neg' : 'pos';
}

async function writeFileEnsuringDir(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, 'utf8');
}

async function writeNoJekyll(outDir) {
  await writeFileEnsuringDir(path.join(outDir, '.nojekyll'), '\n');
}

async function write404Page(outDir) {
  const assetDir = path.join(outDir, 'assets');
  const pngPath = path.join(assetDir, '404-duck.png');

  // The custom 404 image is stored in the repo and copied into the published output.
  await fsp.mkdir(path.dirname(pngPath), { recursive: true });
  await fsp.copyFile(path.join(process.cwd(), 'media', 'gh-pages-404.png'), pngPath);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>404 - Page not Found</title>
    <meta name="robots" content="noindex" />
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b0b0b;
        color: #fff;
        font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;
      }
      .wrap {
        width: min(960px, calc(100vw - 32px));
        text-align: center;
      }
      img {
        width: 100%;
        height: auto;
        border-radius: 18px;
        box-shadow: 0 18px 60px rgba(0,0,0,.6);
        background: #000;
      }
      .links {
        margin-top: 16px;
        font-size: 14px;
        opacity: .92;
      }
      a { color: #8ab4f8; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <img src="./assets/404-duck.png" alt="404 - Page not Found" />
      <div class="links">
        <a href="./metrics/">Open metrics dashboard</a>
        ·
        <a href="./">Home</a>
      </div>
    </div>
  </body>
</html>
`;

  await writeFileEnsuringDir(path.join(outDir, '404.html'), html);
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
  const unitTests = current?.tests?.unit;
  const e2eInstaller = current?.tests?.e2e_installer;
  const unitDeltaMs = diff?.deltas?.unit_tests_duration_ms;
  const e2eInstallerDeltaMs = diff?.deltas?.e2e_installer_tests_duration_ms;
  const scriptCodeLines = current?.code?.scriptCodeLines;
  const totalTextLines = current?.code?.totalTextLines;
  const hugeScripts = current?.code?.hugeScripts;
  const flakyTests = current?.tests?.flaky?.count;
  const coverageLinesPct = current?.quality?.coverage?.linesPct;
  const slowTestsThresholdMs = current?.quality?.slowTests?.thresholdMs;
  const slowTestsOver10s = current?.quality?.slowTests?.count;
  const duplicationPct = current?.quality?.duplication?.duplicatedPct;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Barducks Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;margin:40px;background:#fafafa;color:#111}
    h1{font-size:1.6rem;margin:0 0 8px}
    .sub{color:#444;margin:0 0 18px}
    .card{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.06);padding:16px 18px;margin:16px 0}
    .chartBlock{margin-top:18px}
    .chartBlock:first-child{margin-top:0}
    .chartHeader{font-weight:600;margin:0 0 8px}
    table{border-collapse:collapse;width:100%}
    th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-size:14px}
    th{background:#f5f5f5}
    .pos{color:#c0392b}
    .neg{color:#27ae60}
    code{background:#f3f3f3;padding:2px 6px;border-radius:6px}
    @media (max-width: 768px) {
      body{margin:16px}
      .card{padding:12px 14px}
      th,td{padding:8px 10px;font-size:13px}
    }
  </style>
</head>
<body>
  <h1>Barducks Metrics Dashboard</h1>
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
          <td>🧪 Unit tests</td>
          <td>${unitTests?.total ?? 'n/a'} tests / ${fmtTestMs(unitTests?.reportedDurationMs ?? unitTests?.durationMs)}</td>
          <td class="${clsForDelta(unitDeltaMs)}">${fmtTestDelta({
            deltaTotal: diff?.deltas?.unit_tests_total,
            deltaDurationMs: unitDeltaMs
          })}</td>
        </tr>
        <tr>
          <td>🧪 E2E (installer)</td>
          <td>${e2eInstaller?.total ?? 'n/a'} tests / ${fmtTestMs(e2eInstaller?.reportedDurationMs ?? e2eInstaller?.durationMs)}</td>
          <td class="${clsForDelta(e2eInstallerDeltaMs)}">${fmtTestDelta({
            deltaTotal: diff?.deltas?.e2e_installer_tests_total,
            deltaDurationMs: e2eInstallerDeltaMs
          })}</td>
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
        <tr>
          <td>🧾 Script code lines</td>
          <td>${fmtInt(scriptCodeLines)}</td>
          <td class="${clsForDelta(diff?.deltas?.script_code_lines)}">${fmtInt(diff?.deltas?.script_code_lines)}</td>
        </tr>
        <tr>
          <td>📚 Total text lines</td>
          <td>${fmtInt(totalTextLines)}</td>
          <td class="${clsForDelta(diff?.deltas?.total_text_lines)}">${fmtInt(diff?.deltas?.total_text_lines)}</td>
        </tr>
        <tr>
          <td>📜 Huge scripts (&gt;1000 LOC)</td>
          <td>${fmtInt(hugeScripts)}</td>
          <td class="${clsForDelta(diff?.deltas?.huge_scripts)}">${fmtInt(diff?.deltas?.huge_scripts)}</td>
        </tr>
        <tr>
          <td>🎲 Flaky tests (retried)</td>
          <td>${fmtInt(flakyTests)}</td>
          <td class="${clsForDelta(diff?.deltas?.flaky_tests)}">${fmtInt(diff?.deltas?.flaky_tests)}</td>
        </tr>
        <tr>
          <td>🧪 Coverage (lines)</td>
          <td>${fmtPct(coverageLinesPct)}</td>
          <td class="${clsForDeltaInverted(diff?.deltas?.coverage_lines_pct)}">${fmtPct(diff?.deltas?.coverage_lines_pct)}</td>
        </tr>
        <tr>
          <td>🐢 Slow tests (&gt;${fmtThresholdMs(slowTestsThresholdMs)})</td>
          <td>${fmtInt(slowTestsOver10s)}</td>
          <td class="${clsForDelta(diff?.deltas?.slow_tests_over_10s)}">${fmtInt(diff?.deltas?.slow_tests_over_10s)}</td>
        </tr>
        <tr>
          <td>🧬 Duplication (copy/paste)</td>
          <td>${fmtPct(duplicationPct)}</td>
          <td class="${clsForDelta(diff?.deltas?.duplication_pct)}">${fmtPct(diff?.deltas?.duplication_pct)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="card">
    <div class="chartBlock">
      <div class="chartHeader">🧪 Unit tests</div>
      <canvas id="trend-unit" height="200"></canvas>
    </div>
    <div class="chartBlock">
      <div class="chartHeader">🧪 E2E tests</div>
      <canvas id="trend-e2e" height="200"></canvas>
    </div>
    <div class="chartBlock">
      <div class="chartHeader">🧾 Script code lines</div>
      <canvas id="trend-script-loc" height="200"></canvas>
    </div>
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

    function numOrNull(x) {
      return (typeof x === 'number' && Number.isFinite(x)) ? x : null;
    }

    function pickedTestDurationMs(t) {
      return numOrNull(t?.reportedDurationMs ?? t?.durationMs);
    }

    function pickedTestTotal(t) {
      return numOrNull(t?.total);
    }

    function renderTestChart({ canvasId, durationDatasets, totalDatasets }) {
      const el = document.getElementById(canvasId);
      if (!el) return;
      const ctx = el.getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            ...durationDatasets.map((d) => ({
              ...d,
              yAxisID: 'y',
              spanGaps: true,
              tension: 0.25,
              pointRadius: 0
            })),
            ...totalDatasets.map((d) => ({
              ...d,
              yAxisID: 'y2',
              spanGaps: true,
              tension: 0.25,
              pointRadius: 0,
              borderDash: [6, 4],
              hidden: d.hidden ?? true
            }))
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom' } },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'duration (s)' },
              ticks: { callback: (v) => (typeof v === 'number' ? v + 's' : v) }
            },
            y2: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'tests' } }
          }
        }
      });
    }

    function renderSimpleLineChart({ canvasId, label, data, yTitle, color }) {
      const el = document.getElementById(canvasId);
      if (!el) return;
      const ctx = el.getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label, data, borderColor: color, tension: 0.25, spanGaps: true, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom' } },
          scales: {
            y: { type: 'linear', position: 'left', title: { display: true, text: yTitle } }
          }
        }
      });
    }

    const unitDurationS = history.map(h => {
      const ms = pickedTestDurationMs(h?.tests?.unit);
      return (typeof ms === 'number') ? ms / 1000 : null;
    });
    const unitTotal = history.map(h => pickedTestTotal(h?.tests?.unit));
    renderTestChart({
      canvasId: 'trend-unit',
      durationDatasets: [
        { label: 'Unit duration (s)', data: unitDurationS, borderColor: '#3498db' }
      ],
      totalDatasets: [
        { label: 'Unit total (tests)', data: unitTotal, borderColor: '#3498db', hidden: true }
      ]
    });

    const e2eInstallerDurationS = history.map(h => {
      const ms = pickedTestDurationMs(h?.tests?.e2e_installer);
      return (typeof ms === 'number') ? ms / 1000 : null;
    });
    const e2eInstallerTotal = history.map(h => pickedTestTotal(h?.tests?.e2e_installer));
    const e2eSmokeDurationS = history.map(h => {
      const ms = pickedTestDurationMs(h?.tests?.e2e_smoke);
      return (typeof ms === 'number') ? ms / 1000 : null;
    });
    const e2eSmokeTotal = history.map(h => pickedTestTotal(h?.tests?.e2e_smoke));
    renderTestChart({
      canvasId: 'trend-e2e',
      durationDatasets: [
        { label: 'Installer duration (s)', data: e2eInstallerDurationS, borderColor: '#9b59b6' },
        { label: 'Smoke duration (s)', data: e2eSmokeDurationS, borderColor: '#e67e22' }
      ],
      totalDatasets: [
        { label: 'Installer total (tests)', data: e2eInstallerTotal, borderColor: '#9b59b6', hidden: true },
        { label: 'Smoke total (tests)', data: e2eSmokeTotal, borderColor: '#e67e22', hidden: true }
      ]
    });

    const scriptLoc = history.map(h => numOrNull(h?.code?.scriptCodeLines));
    renderSimpleLineChart({
      canvasId: 'trend-script-loc',
      label: 'Script code lines',
      data: scriptLoc,
      yTitle: 'lines',
      color: '#2ecc71'
    });
  </script>
</body>
</html>`;

  const metricsOutDir = path.join(outDir, 'metrics');
  await fsp.mkdir(metricsOutDir, { recursive: true });
  await writeFileEnsuringDir(path.join(metricsOutDir, 'index.html'), html);

  // Project stats badge (published to GitHub Pages alongside the dashboard).
  const badgeSvg = makeSimpleBadgeSvg({
    label: 'project stats',
    message: '',
    labelColor: '#0366d6',
    messageColor: '#0366d6'
  });
  await writeFileEnsuringDir(path.join(metricsOutDir, 'project-stats.svg'), badgeSvg);

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

  // GitHub Pages behavior depends on root-level files.
  // - `.nojekyll` disables Jekyll processing.
  // - `404.html` is used as the custom not-found page.
  await writeNoJekyll(outDir);
  await write404Page(outDir);

  // eslint-disable-next-line no-console
  console.log('[metrics] dashboard wrote', path.join(metricsOutDir, 'index.html'));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err) + '\n');
  process.exitCode = 0;
});

