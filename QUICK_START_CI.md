# CI & Metrics Dashboard - Quick Start Guide

## 🚀 What You Have Now

A **unified CI system** with:
- ✅ Single workflow (tests run once)
- ✅ Beautiful HTML dashboard
- ✅ GitHub Pages deployment
- ✅ Baseline comparison
- ✅ Trend charts

## 📦 Quick Commands

```bash
# Collect metrics
npm run ci:metrics

# Update history
npm run ci:history

# Generate HTML dashboard
npm run ci:report

# Full pipeline (all at once)
npm run ci:metrics && npm run ci:history && npm run ci:report

# View dashboard
open .cache/metrics/metrics.html

# Log AI action
npm run ci:ai-log simple-log "agent" "message" '{"key":"value"}'
```

## 🔄 How It Works

### On Pull Request

1. Workflow runs automatically
2. Tests execute **once**
3. Metrics collected
4. Compared with main branch
5. PR comment posted with results

### On Main Merge

Everything above, **plus**:
- Metrics committed to repo
- Dashboard deployed to GitHub Pages
- Live at: `https://[owner].github.io/devduck/metrics.html`

## 🎯 First Time Setup

### 1. Merge This PR

```bash
# This activates the unified CI workflow
git merge [this-branch] main
git push origin main
```

### 2. Enable GitHub Pages (One-Time)

1. Go to repo **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `gh-pages` → `/root`
4. Click **Save**

Wait 2-3 minutes, then visit:
```
https://[your-github-username].github.io/devduck/metrics.html
```

### 3. Done! ✅

Future PRs will automatically:
- Run tests once
- Collect metrics
- Show deltas vs main
- Post PR comment
- Update dashboard on merge

## 📊 What Gets Tracked

| Metric | Description |
|--------|-------------|
| 🏗 Build Time | Time to run `npm run build` |
| 🧪 Test Time | Time to run `npm test` |
| 📦 Bundle Size | Size of `dist/` directory |
| ✅ Tests Status | Passed/Failed counts |
| 📊 Code Changes | Lines added/deleted |
| 📅 History | Last 30 CI runs |

## 📈 Dashboard Features

**6 Metric Cards:**
- Build time with delta
- Test time with delta
- Bundle size with delta
- Tests status with badge
- Code changes (+/-)
- History count

**2 Charts:**
- Build & Test Time Trends
- Bundle Size Trend

**Design:**
- Gradient purple background
- Interactive hover effects
- Chart.js line graphs
- Mobile responsive

## 🔍 Check Your PR

After workflow runs, your PR will have:

```markdown
### 🧠 CI Metrics Dashboard

| Metric | Current | Δ vs main |
|--------|---------|-----------|
| 🏗 Build time | 45.2s | 🟢 -2.3s |
| 🧪 Test time | 12.8s | 🔴 +1.5s |
| 📦 Bundle size | 1000 KB | 🟢 -50 KB |

🧩 Artifacts: Available in workflow
📈 Dashboard: https://[owner].github.io/devduck/metrics.html
```

## 🧪 Test Locally

```bash
# Run full pipeline
npm run ci:metrics && npm run ci:history && npm run ci:report

# Check output
ls -lh .cache/metrics/

# Expected files:
# - current.json   (~200 B)
# - history.json   (~500 B)
# - metrics.html   (~5-8 KB)

# Open dashboard
open .cache/metrics/metrics.html
```

## 📁 File Locations

```
.cache/
├─ metrics/
│  ├─ current.json   # Latest metrics
│  ├─ baseline.json  # From main branch
│  ├─ diff.json      # Calculated deltas
│  ├─ history.json   # Last 30 runs
│  └─ metrics.html   # Dashboard
├─ logs/
│  ├─ test.log       # Test output
│  └─ build.log      # Build output
├─ ai_logs/
│  └─ *.json         # AI agent logs
└─ playwright/
   └─ *              # Test artifacts
```

## 🛠 Troubleshooting

### Dashboard not showing on GitHub Pages

1. Check Settings → Pages is configured
2. Wait 2-3 minutes after merge
3. Clear browser cache
4. Check `gh-pages` branch exists

### No baseline comparison

- First PR won't have baseline
- Baseline created after first main merge
- Run once on main to establish baseline

### Metrics not collected

```bash
# Check logs
cat .cache/logs/test.log
cat .cache/logs/build.log

# Check metrics file
cat .cache/metrics/current.json

# Run with debug
npm run ci:metrics
```

## 📚 Full Documentation

- **Architecture**: [CI_UNIFIED_IMPLEMENTATION.md](CI_UNIFIED_IMPLEMENTATION.md)
- **PR Description**: [PR_DESCRIPTION.md](PR_DESCRIPTION.md)
- **Complete Summary**: [FINAL_IMPLEMENTATION_SUMMARY.md](FINAL_IMPLEMENTATION_SUMMARY.md)
- **Original Docs**: [docs/CI_METRICS.md](docs/CI_METRICS.md)

## ⚡ Key Benefits

| Before | After |
|--------|-------|
| 2 workflows | 1 workflow |
| Tests run 2x | Tests run 1x |
| ~3 min CI | ~2 min CI |
| No dashboard | Beautiful HTML |
| No public view | GitHub Pages |
| Manual compare | Auto baseline |
| No history | Last 30 runs |
| No charts | Chart.js graphs |

## 🎉 You're Done!

The CI system is **ready to use**. Just:

1. ✅ Merge this PR
2. ✅ Configure GitHub Pages
3. ✅ Open a test PR
4. ✅ Watch it work!

Future PRs will automatically get metrics, comparisons, and beautiful dashboards.

---

**Questions?** Check the full docs linked above.

**Issues?** Review troubleshooting section or workflow logs.

🦆 **DevDuck CI v2.0** - Dashboard Upgrade Complete! 🚀
