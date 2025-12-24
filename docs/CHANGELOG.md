# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - 2025-12-24

- ✨ Automatic installation of project scripts to workspace `package.json` ([PR #12](https://github.com/holiber/devduck/pull/12))
  - Copies standard scripts (`test`, `dev`, `build`, `start`, `lint`) from projects to workspace with `{projectName}:{scriptName}` format
  - Supports additional scripts via `importScripts` config field
  - See [ARCHITECTURE.md](ARCHITECTURE.md#project-scripts-installation) for details

---

## [0.1.0] - 2025-12-24

### Added - 2025-12-24

- 📝 Workspace config schema and documentation ([PR #11](https://github.com/holiber/devduck/pull/11))

### Added - 2025-12-23

- ✨ Workspace-local module installation ([PR #10](https://github.com/holiber/devduck/pull/10))
  - Modules in workspace `modules/` directory take precedence over built-in/external ones

### Changed - 2025-12-23

- 🔧 Migrated module CLIs to `yargs` for consistent interface ([PR #9](https://github.com/holiber/devduck/pull/9))
  - Added shared utilities: `scripts/lib/cli.js`, `scripts/lib/workspace-root.js`, `scripts/lib/devduck-paths.js`

---

[Unreleased]: https://github.com/holiber/devduck/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/holiber/devduck/releases/tag/v0.1.0

