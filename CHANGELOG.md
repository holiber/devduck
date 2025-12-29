# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added - 2025-12-29

- ✅ **Follow Guidelines** - CI blocks merges unless the PR adds a new task file under `docs/tasks/` and updates `CHANGELOG.md`.
- 🔁 **One retry for tests in CI** - Unit and Playwright installer suites retry once after a short delay.
- 📊 **Trusted main metrics** - `main` runs update metrics baseline/history and publish GitHub Pages only when tests pass.
- 🏷️ **Baseline stamping** - Baseline includes `commit`, `pr`, and `timestamp` for traceability.
- 🧠 **CI Metrics Dashboard status** - PR metrics comment now shows BUILDING/REBUILDING/FAIL status to avoid stale dashboards during reruns.

### Changed - 2025-12-29

- 📐 **Contributor guidance** - Added `.cursorrules` and a PR template checklist to make PR requirements hard to miss.
- 🔔 **PR metrics comment** - Added a **gh-pages / GitHub Pages disabled** warning under the dashboard link (detects `404` from the dashboard URL).
- 🧹 **PR metrics comment** - Removed duplicate PR title/number and code diff lines (already visible on the PR page).
- 🔤 **Renamed GitHub Actions workflow** - “CI & Metrics Dashboard” → “Tests & Metrics”

---

## 0.3.0 - 2025-12-28

### Added - 2025-12-28

- 📊 **PR metrics dashboard + reports** (PR #73)
- 🧪 **Playwright runner test coverage** (PR #72)
- 📚 **Workspace modules documentation** (PR #71)

### Changed - 2025-12-28

- 🧰 **Installer CLI refactor** - Moved CLI argument parsing + workspace path resolution into `scripts/install/cli-runtime.ts`, keeping installer steps visible near the top of `scripts/install.ts`.
- 🔌 **DevduckService socket fallback** - On macOS, when the default Unix socket path is too long, DevduckService now falls back to a short `/tmp/devduck-<hash>.sock` path to avoid `EINVAL` on `listen()`.
- 🧾 **Taskfile install improvements** - Quieter output and more robust checks during Taskfile-driven installation (PR #68)
- 🧪 **Installer tests migrated to Playwright** (PR #59)
- 📦 **CI metrics and artifacts recording** (PR #69)

### Fixed - 2025-12-28

- 🛠️ **MCP tools listing for nested `mcpSettings`** (PR #65)

### Changed - 2025-12-27

- 🧾 **Installer state file** - Deprecated/removed `.cache/install-check.json`; installer now uses `.cache/install-state.json` as the single source of truth (including `installedModules`).
- 🪵 **Installer logging** - Installation now uses a pino-compatible (levels-only) logger writing NDJSON into `.cache/install.log`.
- 🧩 **Installer runner** - Workspace installation orchestration is driven by a small `runInstall(steps, ctx)` runner and step wrappers for readability.

### Changed - 2025-12-26

- ⏪ **Reverted Trinicode project setup** (PR #55)

### Fixed - 2025-12-25

- 🔧 **API command handling in install checks** - Fixed issue where `api` commands (e.g., `api mcp.hasTool deepagent generate_answer`) were not properly handled during installation checks
  - Commands starting with `api ` are now automatically transformed to `npm run call -- ...` before execution
  - API commands now run from workspace root directory to ensure proper context
  - Result parsing correctly checks for `true` output to determine success
  - Fixes error: "api: command not found" when running `npm run install` with auth checks that use API commands
  - Pre-install checks already had this handling; now install checks have the same functionality

### Added - 2025-12-25

- 📝 **Default .gitignore file for github-ci module** - Added `gitignore.default` file to github-ci module that is automatically used to create `.gitignore` files in workspaces
  - If `gitignore` setting is not provided in module settings, the default file is used
  - Ensures every workspace with github-ci module gets a proper `.gitignore` file automatically
  - Similar to how ya-arc module handles `.arcignore` files

- 🦆 **DevduckService (local dev service) MVP** - Added a local background service for dev + AI agents with IPC control plane and file-based logs
  - tRPC API over Unix domain socket: `.cache/devduck-service/ipc/devduck.sock`
  - Process supervision (start/stop/status) with persistent session: `.cache/devduck-service/session.json`
  - Per-process stdout/stderr logs in `.cache/devduck-service/logs/` (e.g. `server.out.log`, `client.err.log`)
  - Playwright smokecheck runner with browser console capture to `.cache/devduck-service/logs/browser-console.log`
  - New npm scripts: `devduck:service` and `devduck:launch`
  - Added CI-friendly tests covering process lifecycle, readiness, smokecheck, browser console capture, session reuse, and stop semantics

### Changed - 2025-12-25

- 🧹 **Removed external repository references** - Removed all traces of external repositories (ya-* modules) from documentation and code
  - Removed specific ya-* module references from ARCHITECTURE.md
  - Updated MODULE.md files to use generic "external modules" instead of specific ya-* module names
  - Refactored plan module to use dynamic provider discovery instead of hardcoded imports
  - Generalize example paths and registry references
  - Ensures the public DevDuck repository remains focused on core framework features

### Changed - 2025-12-25

- 🔗 **Symlink support for external repositories** - External repositories from `workspace.config.yml.repos` now create symlinks when the same repo exists in `projects/`
  - Repositories appear in `devduck/%repo_name%` directory
  - If the same repo is listed in `projects`, a symlink is created from `devduck/%repo_name%` to `projects/%repo_name%`
  - For Arcadia repos not in projects, symlinks are created to the actual Arcadia path
  - Eliminates duplication and ensures consistency between repos and projects

- 📊 **Improved pre-install check output** - Reduced information duplication in check results
  - Successful checks now show only token name and module (without description)
  - Removed redundant "Test check passed" line for successful checks
  - Failed checks continue to show full details including description and docs for better debugging

- ⚡ **Fixed repository loading delay** - Moved success message to after modules are loaded to avoid appearing "stuck"
  - Repository loading message now appears after all modules are parsed
  - Message includes module count for better visibility

### Added - 2025-12-25

- 🔧 **Automatic environment variable installation from install commands** - Pre-install checks now automatically run install commands when required environment variables are missing
  - When a test check requires a variable (e.g., `ARCADIA_ROOT`) and has an `install` field, the install command is executed automatically
  - The install command output is captured and used to set the variable for the test execution
  - Variables are automatically written to `.env` file to persist them for future runs
  - Eliminates the need to manually set variables that can be derived from commands (e.g., `arc root` for `ARCADIA_ROOT`)
  - See `ARCHITECTURE.md` for configuration details

- 📚 **Documentation links in auth check failures** - Auth checks can now include a `docs` field that provides helpful links when checks fail
  - The `docs` field is displayed in cyan below the error message when an auth check fails
  - Helps users quickly find documentation on how to obtain required tokens
  - Example: `docs: "Obtain your token here: https://docs.example.com/tokens"`

### Changed - 2025-12-25

- 📦 **External repositories clone location** - Git repositories listed in `workspace.config.yml.repos` are now cloned under `<workspace>/devduck/` (instead of `.cache/...`).
- 🧭 **Module resolution priority** - When installing a module by name, resolution now prefers:
  - `<workspace>/modules/`
  - `<workspace>/projects/*/modules/`
  - DevDuck built-in `modules/`
- 🗂️ **Persist resolved module paths** - Installer now records installed module name → path mapping in `.cache/install-state.json` (`installedModules`) for downstream tooling.

### Added - 2025-12-24

- ✅ **Checks system** - Modules can define checks to verify required environment variables and validate token functionality
  - Auth checks verify that required tokens are present before installation
  - Test checks validate token functionality using `curl` commands or HTTP requests
  - Checks are collected from all modules and projects before installation
  - Missing tokens are reported with descriptions for better error messages
  - Successful checks are displayed in green, failed checks show HTTP status codes
  - Installation fails if required tokens are missing or tests fail
  - See `ARCHITECTURE.md` for configuration details

- 🔌 **CI module provider discovery from external repositories** - CI module now discovers providers from external repositories defined in `workspace.config.yml`
  - Providers from `repos` in workspace config are automatically loaded
  - Enables using providers from external module repositories
  - Works with both Arcadia (`arc://`) and Git repository URLs

- 📁 **Workspace repository resolution** - Improved repository path resolution for Arcadia repositories
  - First checks if repository exists in workspace `projects/` directory
  - Falls back to Arcadia root detection if not found in workspace
  - Supports both relative paths (e.g., `arc://junk/user/repo`) and absolute paths
  - Allows using same `workspace.config.yml` across different developer machines

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

- ✉️ **Email module with provider system** - Added `modules/email/` with a Zod-based provider contract and a `/email` command
  - Contract lives in `modules/email/schemas/contract.ts` (tools, common types, provider manifest)
  - Provider selection via `EMAIL_PROVIDER`, `workspace.config.yml` (`moduleSettings.email.provider`), or first discovered provider

- 🧩 **Global provider registry** - Added `scripts/lib/provider-registry.ts` for registering and discovering providers across modules
  - Supports module scanning for providers from both `modules/<module>/providers/*` and standalone provider modules (`modules/<module>/PROVIDER.md`)
  - Optional per-provider-type Zod validation at registration time

- 🧪 **Smogcheck email provider tests** - Added automated tests for `smogcheck-provider`
  - Verifies contract compliance and tool behavior (`getMessage`, `searchMessages`, `downloadAttachment`, `listUnreadMessages`)
  - Verifies provider discovery/registration via the global registry

---

## 0.2.0 - 2025-12-24

### Changed - 2025-12-24

- 🔄 **Full TypeScript migration** - Complete migration from JavaScript to TypeScript (PR #13)
  - Converted all `.js` files to `.ts` with ES Modules
  - Replaced CommonJS (`require`/`module.exports`) with ES Modules (`import`/`export`)
  - Added TypeScript types and interfaces throughout the codebase
  - Updated all scripts to use `tsx` for direct TypeScript execution without compilation
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

- ✨ Automatic installation of project scripts to workspace `package.json` (PR #12)
  - Copies standard scripts (`test`, `dev`, `build`, `start`, `lint`) from projects to workspace with `{projectName}:{scriptName}` format
  - Supports additional scripts via `importScripts` config field
  - See [ARCHITECTURE.md](ARCHITECTURE.md#project-scripts-installation) for details

---

## 0.1.0 - 2025-12-24

### Added - 2025-12-24

- 📝 Workspace config schema and documentation (PR #11)

### Added - 2025-12-23

- ✨ Workspace-local module installation (PR #10)
  - Modules in workspace `modules/` directory take precedence over built-in/external ones

### Changed - 2025-12-23

- 🔧 Migrated module CLIs to `yargs` for consistent interface (PR #9)
  - Added shared utilities: `scripts/lib/cli.js`, `scripts/lib/workspace-root.js`, `scripts/lib/devduck-paths.js`

---
