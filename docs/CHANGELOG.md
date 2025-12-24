# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed - 2025-12-24

- 🔄 **Improved version compatibility check for external modules** - Modules with older `devduckVersion` can now be loaded (backward compatibility)
  - Modules are compatible if their `devduckVersion <= current devduck version`
  - Error is only raised if module requires newer devduck version than currently installed
  - Allows using old modules with newer devduck versions

### Added - 2025-12-24

- ✨ **Support for loading modules from projects directory** - Modules in `projects/*/modules/` are now automatically discovered and loaded
  - Modules from projects are loaded alongside workspace-local and external repository modules
  - Enables easier module development and testing in workspace projects

- 🧪 **Automatic test runner script** - Added `scripts/run-tests.ts` that automatically discovers and runs all test files
  - No need to manually list test files in `package.json`
  - Automatically finds all `.test.ts` files in `tests/` directory
  - Scales better as new tests are added

---

## [0.2.0] - 2025-12-24

### Changed - 2025-12-24

- 🔄 **Full TypeScript migration** - Complete migration from JavaScript to TypeScript ([PR #13](https://github.com/holiber/devduck/pull/13))
  - Converted all `.js` files to `.ts` with ES Modules
  - Replaced CommonJS (`require`/`module.exports`) with ES Modules (`import`/`export`)
  - Added TypeScript types and interfaces throughout the codebase
  - Updated all scripts to use `tsx` for direct TypeScript execution
  - All tests passing (22/22) after migration

### Technical Details

- **TypeScript Configuration**: Added `tsconfig.json` with strict mode enabled
- **Module System**: Migrated from CommonJS to ES Modules (`"type": "module"`)
- **Execution**: Using `tsx` for direct TypeScript file execution without compilation
- **Dependencies**: Added `typescript@^5.6.0`, `tsx@^4.19.0`, `@types/node@^22.0.0`
- **Files Converted**: 
  - All utility scripts (`scripts/**/*.js` → `scripts/**/*.ts`)
  - All module scripts (`modules/**/scripts/*.js` → `modules/**/scripts/*.ts`)
  - All test files (`tests/**/*.test.js` → `tests/**/*.test.ts`)
  - All schema files (`scripts/schemas/*.zod.js` → `scripts/schemas/*.zod.ts`)

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

[Unreleased]: https://github.com/holiber/devduck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/holiber/devduck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/holiber/devduck/releases/tag/v0.1.0

