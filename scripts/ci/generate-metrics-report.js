#!/usr/bin/env node
/**
 * Generate HTML Metrics Report
 * Creates a beautiful HTML dashboard with charts using Chart.js
 */
import fs from 'fs';
import path from 'path';

const METRICS_DIR = '.cache/metrics';
const CURRENT_FILE = path.join(METRICS_DIR, 'current.json');
const DIFF_FILE = path.join(METRICS_DIR, 'diff.json');
const HISTORY_FILE = path.join(METRICS_DIR, 'history.json');
const OUTPUT_FILE = path.join(METRICS_DIR, 'metrics.html');

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return 'N/A';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatTime(seconds) {
  if (!seconds) return 'N/A';
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs.toFixed(0)}s`;
}

function generateHTML() {
  console.log('📊 Generating HTML metrics report...');
  
  // Load data
  let current = {};
  let diff = {};
  let history = [];
  
  try {
    if (fs.existsSync(CURRENT_FILE)) {
      current = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf-8'));
    } else {
      console.log('⚠️  No current metrics found');
    }
    
    if (fs.existsSync(DIFF_FILE)) {
      diff = JSON.parse(fs.readFileSync(DIFF_FILE, 'utf-8'));
    }
    
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      if (!Array.isArray(history)) history = [];
    }
  } catch (error) {
    console.error('❌ Error loading metrics:', error.message);
    return;
  }
  
  // Helper to format delta
  const formatDelta = (value, unit = '') => {
    if (value === undefined || value === null) return '—';
    const sign = value >= 0 ? '+' : '';
    const color = value > 0 ? '#e74c3c' : value < 0 ? '#27ae60' : '#95a5a6';
    return `<span style="color: ${color}; font-weight: 600;">${sign}${typeof value === 'number' ? value.toFixed(2) : value}${unit}</span>`;
  };
  
  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevDuck CI Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 40px 20px;
      color: #2c3e50;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    }
    
    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .subtitle {
      color: #7f8c8d;
      font-size: 0.95rem;
    }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .metric-card {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .metric-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.15);
    }
    
    .metric-icon {
      font-size: 2rem;
      margin-bottom: 10px;
    }
    
    .metric-label {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #7f8c8d;
      margin-bottom: 8px;
      font-weight: 600;
    }
    
    .metric-value {
      font-size: 2rem;
      font-weight: 700;
      color: #2c3e50;
      margin-bottom: 8px;
    }
    
    .metric-delta {
      font-size: 0.9rem;
    }
    
    .chart-container {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    }
    
    .chart-title {
      font-size: 1.3rem;
      margin-bottom: 20px;
      color: #2c3e50;
      font-weight: 600;
    }
    
    canvas {
      max-height: 400px;
    }
    
    .footer {
      text-align: center;
      color: white;
      margin-top: 40px;
      font-size: 0.9rem;
      opacity: 0.8;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .badge-success {
      background: #d4edda;
      color: #155724;
    }
    
    .badge-danger {
      background: #f8d7da;
      color: #721c24;
    }
    
    @media (max-width: 768px) {
      .metrics-grid {
        grid-template-columns: 1fr;
      }
      
      h1 {
        font-size: 1.8rem;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🦆 DevDuck CI Metrics Dashboard</h1>
      <p class="subtitle">
        <strong>Generated:</strong> ${new Date().toLocaleString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit',
          timeZoneName: 'short'
        })}
      </p>
      ${current.pr_number ? `
      <p class="subtitle" style="margin-top: 8px;">
        <strong>PR #${current.pr_number}:</strong> ${current.pr_title || 'N/A'} by ${current.pr_author || 'N/A'}
      </p>` : ''}
    </div>
    
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon">🏗</div>
        <div class="metric-label">Build Time</div>
        <div class="metric-value">${formatTime(current.build_time_sec)}</div>
        ${diff.build_delta !== undefined ? `<div class="metric-delta">Δ vs main: ${formatDelta(diff.build_delta, 's')}</div>` : ''}
      </div>
      
      <div class="metric-card">
        <div class="metric-icon">🧪</div>
        <div class="metric-label">Test Time</div>
        <div class="metric-value">${formatTime(current.test_time_sec)}</div>
        ${diff.test_delta !== undefined ? `<div class="metric-delta">Δ vs main: ${formatDelta(diff.test_delta, 's')}</div>` : ''}
      </div>
      
      <div class="metric-card">
        <div class="metric-icon">📦</div>
        <div class="metric-label">Bundle Size</div>
        <div class="metric-value">${formatBytes(current.bundle_size_bytes)}</div>
        ${diff.bundle_delta !== undefined ? `<div class="metric-delta">Δ vs main: ${formatDelta(diff.bundle_delta / 1024, ' KB')}</div>` : ''}
      </div>
      
      <div class="metric-card">
        <div class="metric-icon">✅</div>
        <div class="metric-label">Tests Status</div>
        <div class="metric-value">
          ${current.test_passed || 0} / ${current.test_count || 0}
        </div>
        <div class="metric-delta">
          <span class="badge ${(current.test_failed || 0) === 0 ? 'badge-success' : 'badge-danger'}">
            ${(current.test_failed || 0) === 0 ? 'All Passed' : `${current.test_failed} Failed`}
          </span>
        </div>
      </div>
      
      <div class="metric-card">
        <div class="metric-icon">📊</div>
        <div class="metric-label">Code Changes</div>
        <div class="metric-value">
          <span style="color: #27ae60;">+${current.pr_additions || current.code_additions || 0}</span>
          /
          <span style="color: #e74c3c;">-${current.pr_deletions || current.code_deletions || 0}</span>
        </div>
        <div class="metric-delta">${current.pr_changed_files || 0} files changed</div>
      </div>
      
      <div class="metric-card">
        <div class="metric-icon">📅</div>
        <div class="metric-label">History</div>
        <div class="metric-value">${history.length}</div>
        <div class="metric-delta">recorded runs</div>
      </div>
    </div>
    
    ${history.length > 1 ? `
    <div class="chart-container">
      <h2 class="chart-title">📈 Build & Test Time Trends</h2>
      <canvas id="timeChart"></canvas>
    </div>
    
    <div class="chart-container">
      <h2 class="chart-title">📦 Bundle Size Trend</h2>
      <canvas id="bundleChart"></canvas>
    </div>
    ` : '<div class="chart-container"><p style="text-align: center; color: #7f8c8d;">More data needed for charts (minimum 2 runs)</p></div>'}
    
    <div class="footer">
      <p>DevDuck CI Metrics Dashboard • Powered by GitHub Actions & Chart.js</p>
    </div>
  </div>
  
  ${history.length > 1 ? `
  <script>
    const historyData = ${JSON.stringify(history)};
    
    // Time chart
    const timeCtx = document.getElementById('timeChart');
    if (timeCtx) {
      new Chart(timeCtx, {
        type: 'line',
        data: {
          labels: historyData.map(d => {
            const date = new Date(d.timestamp);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          }),
          datasets: [
            {
              label: 'Build Time (s)',
              data: historyData.map(d => d.build_time_sec || null),
              borderColor: '#3498db',
              backgroundColor: 'rgba(52, 152, 219, 0.1)',
              tension: 0.4,
              fill: true
            },
            {
              label: 'Test Time (s)',
              data: historyData.map(d => d.test_time_sec || null),
              borderColor: '#9b59b6',
              backgroundColor: 'rgba(155, 89, 182, 0.1)',
              tension: 0.4,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              position: 'top',
            },
            tooltip: {
              mode: 'index',
              intersect: false,
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Time (seconds)'
              }
            }
          }
        }
      });
    }
    
    // Bundle chart
    const bundleCtx = document.getElementById('bundleChart');
    if (bundleCtx) {
      new Chart(bundleCtx, {
        type: 'line',
        data: {
          labels: historyData.map(d => {
            const date = new Date(d.timestamp);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          }),
          datasets: [
            {
              label: 'Bundle Size (KB)',
              data: historyData.map(d => d.bundle_size_bytes ? (d.bundle_size_bytes / 1024).toFixed(2) : null),
              borderColor: '#2ecc71',
              backgroundColor: 'rgba(46, 204, 113, 0.1)',
              tension: 0.4,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: {
              position: 'top',
            },
            tooltip: {
              mode: 'index',
              intersect: false,
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Size (KB)'
              }
            }
          }
        }
      });
    }
  </script>
  ` : ''}
</body>
</html>`;
  
  // Save HTML
  fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');
  console.log(`✅ HTML report generated: ${OUTPUT_FILE}`);
  console.log(`📊 Included ${history.length} historical data points`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateHTML();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

export { generateHTML };
