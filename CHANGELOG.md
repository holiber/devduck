# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **CI Metrics and Artifacts System** - Comprehensive metrics collection for every PR
  - Automatic collection of build time, test time, bundle size, and code changes
  - Playwright integration with screenshots and videos for failed tests
  - AI agent logging for tracking development decisions
  - Metrics comparison and visualization tools
  - Automatic PR comments with metrics summary
  - 30-day artifact retention with logs, screenshots, and videos
- New scripts:
  - `scripts/ci/collect-metrics.ts` - Main metrics collector
  - `scripts/ci/ai-logger.ts` - AI agent interaction logger
  - `scripts/ci/compare-metrics.ts` - Metrics comparison tool
  - `scripts/ci/visualize-metrics.ts` - ASCII charts and trends
- New npm scripts: `ci:metrics`, `ci:compare`, `ci:visualize`, `ci:ai-log`
- GitHub workflow: `.github/workflows/pr-metrics.yml`
- Documentation: `docs/CI_METRICS.md`
- PR template: `.github/PULL_REQUEST_TEMPLATE.md`

### Changed

- Updated README.md with CI metrics documentation
- Enhanced .gitignore with comprehensive coverage

## [0.2.0] - Previous Release

<!-- Add previous changelog entries here -->
