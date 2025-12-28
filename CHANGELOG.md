# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added - V2.0: Unified CI & Dashboard

- **Unified CI Workflow** - Single workflow for all CI operations
  - Merged `ci.yml` and `pr-metrics.yml` into one unified workflow
  - Tests now run **only once** per PR (no duplication)
  - ~30-40% faster CI execution
  
- **Beautiful HTML Dashboard** - Chart.js powered metrics visualization
  - Responsive card-based layout with gradient design
  - Interactive line charts for trends (build time, test time, bundle size)
  - Mobile-friendly responsive design
  - Automatic GitHub Pages deployment
  - Public dashboard at: `https://[owner].github.io/devduck/metrics.html`

- **JavaScript Migration** - Core scripts converted to pure JS
  - `scripts/ci/collect-metrics.js` - Metrics collector (no tsx needed)
  - `scripts/ci/update-history.js` - History management (last 30 runs)
  - `scripts/ci/generate-metrics-report.js` - HTML dashboard generator
  - `scripts/ci/ai-logger.js` - AI agent logger

- **Baseline Comparison System**
  - Automatic fetching of baseline from main branch
  - Delta calculation for all metrics
  - Visual indicators in PR comments (🔴 regression, 🟢 improvement)

- **Metrics History Tracking**
  - Rolling history of last 30 CI runs
  - Trend analysis and visualization
  - Historical comparison tools

### Changed

- **Workflow consolidation**: `.github/workflows/ci.yml` now handles all CI operations
- **README.md**: Updated with unified CI documentation
- **package.json**: Updated scripts (`ci:metrics`, `ci:history`, `ci:report`)
- **Documentation**: New `CI_UNIFIED_IMPLEMENTATION.md` with architecture details

### Removed

- `.github/workflows/pr-metrics.yml` - Merged into unified `ci.yml`

### Kept for Manual Use

- `scripts/ci/compare-metrics.ts` - Manual comparisons (TypeScript)
- `scripts/ci/visualize-metrics.ts` - CLI visualization (TypeScript)
- `scripts/ci/verify-setup.ts` - Setup verification
- Original TypeScript versions for advanced usage

## [0.2.0] - Initial CI Implementation

### Added

- **CI Metrics and Artifacts System** - Comprehensive metrics collection
  - Automatic collection of build time, test time, bundle size, code changes
  - Playwright integration with screenshots and videos for failed tests
  - AI agent logging for tracking development decisions
  - 30-day artifact retention
- TypeScript scripts for metrics collection
- Documentation: `docs/CI_METRICS.md`, `docs/CI_SETUP_GUIDE.md`
- PR template: `.github/PULL_REQUEST_TEMPLATE.md`

<!-- Previous versions -->
