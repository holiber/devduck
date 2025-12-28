#!/usr/bin/env npx tsx
/**
 * Generates HTML metrics report with tables and charts.
 * 
 * Reads:
 *   - .cache/metrics/current.json
 *   - .cache/metrics/diff.json (optional)
 *   - .cache/metrics/history.json (optional)
 * 
 * Outputs:
 *   - .cache/metrics/metrics.html
 *   - .cache/metrics/index.html (copy for GitHub Pages)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG } from './types.js';
import type { HistoryEntry } from './update-history.js';

const config = DEFAULT_CONFIG;

interface DiffData {
  buildDelta?: number;
  devDelta?: number;
  bundleDelta?: number;
  current?: {
    buildTimeSec?: number;
    devStartTimeSec?: number;
    bundleSizeBytes?: number;
  };
}

function readJsonSafe<T>(filePath: string, defaultValue: T): T {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8')) as T;
    }
  } catch {
    console.warn(`Warning: Could not read ${filePath}`);
  }
  return defaultValue;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDelta(value: number, unit: string): string {
  if (value === 0) return '0';
  const sign = value > 0 ? '+' : '';
  const cls = value > 0 ? 'delta-neg' : 'delta-pos';
  return `<span class="${cls}">${sign}${value}${unit}</span>`;
}

function generateReport(): void {
  mkdirSync(config.metricsDir, { recursive: true });

  const currentPath = path.join(config.metricsDir, 'current.json');
  const diffPath = path.join(config.metricsDir, 'diff.json');
  const historyPath = path.join(config.metricsDir, 'history.json');

  const current = readJsonSafe(currentPath, {
    buildTimeSec: 0,
    devStartTimeSec: 0,
    bundleSizeBytes: 0,
    timestamp: new Date().toISOString(),
  });

  const diff = readJsonSafe<DiffData>(diffPath, {});
  const history = readJsonSafe<HistoryEntry[]>(historyPath, []);

  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevDuck Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    
    header h1 {
      font-size: 1.5rem;
      font-weight: 600;
    }
    
    header .logo {
      font-size: 2rem;
    }
    
    .meta {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-left: auto;
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1.5rem;
    }
    
    .card h2 {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    
    .metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
    }
    
    .metric:last-child {
      border-bottom: none;
    }
    
    .metric-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .metric-value {
      font-size: 1.25rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    
    .metric-delta {
      font-size: 0.875rem;
      margin-left: 0.5rem;
    }
    
    .delta-pos { color: var(--green); }
    .delta-neg { color: var(--red); }
    
    .chart-container {
      position: relative;
      height: 300px;
      margin-top: 1rem;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      font-weight: 500;
      color: var(--text-muted);
    }
    
    tbody tr:hover {
      background: rgba(88, 166, 255, 0.1);
    }
    
    .status-pass { color: var(--green); }
    .status-fail { color: var(--red); }
    
    footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.75rem;
      text-align: center;
    }
    
    footer a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="logo">🦆</span>
      <h1>DevDuck Metrics Dashboard</h1>
      <span class="meta">Generated: ${generatedAt}</span>
    </header>
    
    <div class="grid">
      <div class="card">
        <h2>📊 Current Metrics</h2>
        <div class="metric">
          <span class="metric-label">🏗 Build Time</span>
          <span>
            <span class="metric-value">${current.buildTimeSec ?? 'n/a'}s</span>
            ${diff.buildDelta !== undefined ? `<span class="metric-delta">${formatDelta(diff.buildDelta, 's')}</span>` : ''}
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">⚡ Dev Start</span>
          <span>
            <span class="metric-value">${current.devStartTimeSec ?? 'n/a'}s</span>
            ${diff.devDelta !== undefined ? `<span class="metric-delta">${formatDelta(diff.devDelta, 's')}</span>` : ''}
          </span>
        </div>
        <div class="metric">
          <span class="metric-label">📦 Bundle Size</span>
          <span>
            <span class="metric-value">${formatBytes(current.bundleSizeBytes ?? 0)}</span>
            ${diff.bundleDelta !== undefined ? `<span class="metric-delta">${formatDelta(diff.bundleDelta, 'B')}</span>` : ''}
          </span>
        </div>
      </div>
      
      <div class="card">
        <h2>📈 Trends (Last ${history.length} Runs)</h2>
        <div class="chart-container">
          <canvas id="trendChart"></canvas>
        </div>
      </div>
    </div>
    
    <div class="card">
      <h2>📋 History</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Build Time</th>
            <th>Dev Start</th>
            <th>Bundle Size</th>
            <th>Branch</th>
          </tr>
        </thead>
        <tbody>
          ${history.slice(-10).reverse().map(entry => `
          <tr>
            <td>${new Date(entry.timestamp).toLocaleDateString()}</td>
            <td>${entry.buildTimeSec ?? 'n/a'}s</td>
            <td>${entry.devStartTimeSec ?? 'n/a'}s</td>
            <td>${formatBytes(entry.bundleSizeBytes ?? 0)}</td>
            <td>${entry.branch ?? 'n/a'}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <footer>
      <p>
        DevDuck CI Metrics Dashboard • 
        <a href="https://github.com/holiber/devduck">View on GitHub</a>
      </p>
    </footer>
  </div>
  
  <script>
    const history = ${JSON.stringify(history)};
    
    if (history.length > 0) {
      const ctx = document.getElementById('trendChart').getContext('2d');
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: history.map(d => new Date(d.timestamp).toLocaleDateString()),
          datasets: [
            {
              label: 'Build Time (s)',
              data: history.map(d => d.buildTimeSec ?? 0),
              borderColor: '#58a6ff',
              backgroundColor: 'rgba(88, 166, 255, 0.1)',
              tension: 0.3,
              fill: true,
            },
            {
              label: 'Dev Start (s)',
              data: history.map(d => d.devStartTimeSec ?? 0),
              borderColor: '#a371f7',
              backgroundColor: 'rgba(163, 113, 247, 0.1)',
              tension: 0.3,
              fill: true,
            },
            {
              label: 'Bundle Size (KB)',
              data: history.map(d => (d.bundleSizeBytes ?? 0) / 1024),
              borderColor: '#3fb950',
              backgroundColor: 'rgba(63, 185, 80, 0.1)',
              tension: 0.3,
              fill: true,
              yAxisID: 'y1',
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                color: '#8b949e',
                usePointStyle: true,
              }
            }
          },
          scales: {
            x: {
              grid: { color: '#30363d' },
              ticks: { color: '#8b949e' }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: { display: true, text: 'Time (s)', color: '#8b949e' },
              grid: { color: '#30363d' },
              ticks: { color: '#8b949e' }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: { display: true, text: 'Size (KB)', color: '#8b949e' },
              grid: { drawOnChartArea: false },
              ticks: { color: '#8b949e' }
            }
          }
        }
      });
    }
  </script>
</body>
</html>`;

  const reportPath = path.join(config.metricsDir, 'metrics.html');
  const indexPath = path.join(config.metricsDir, 'index.html');

  writeFileSync(reportPath, html);
  writeFileSync(indexPath, html); // Copy for GitHub Pages

  console.log(`📊 HTML report generated`);
  console.log(`✅ Saved to ${reportPath}`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateReport();
}

export { generateReport };
