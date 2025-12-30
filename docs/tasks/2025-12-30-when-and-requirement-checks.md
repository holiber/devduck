# Add `when` and `requirement` to installer checks

## 0. Meta

- Date: 2025-12-30
- Goal: extend check config with `when` + `requirement` and update installer semantics.

## 1. Task

### What

- Add a new check field: `when` (shell condition; if not satisfied, check is skipped).
- Replace `optional` with `requirement` for checks:
  - `required` (default): a failing check blocks installation
  - `recomended`: installer attempts to install; failure produces a warning, installation still succeeds
  - `optional`: installer does not attempt to install; reports “optional check skipped”
- Add a core module check for ripgrep on macOS:
  - `when`: `[ "$(uname -s)" = "Darwin" ] && ! command -v rg >/dev/null 2>&1`
  - `install`: `brew install ripgrep`
  - `requirement`: `recomended`
  - `description`: “A tool for search. Faster and more powerful than grep. AI agents love this thing”

### Definition of Done

- Workspace config schema supports `checks[].when` and `checks[].requirement`.
- Installer respects requirement semantics:
  - required failures stop installation
  - recomended failures do not stop installation (warn)
  - optional checks are skipped and not installed
- Core module contains the ripgrep check as described.
- Tests pass.

## 2. Status Log

- 2025-12-30: Added schema/types support for `when` and `requirement` (WIP).

## 3. Plan

- Update check schemas (Zod + JSON Schema).
- Implement `when` evaluation and `requirement` handling in check runner.
- Enforce requirement behavior in installer steps and selected checks runner.
- Add core module check.
- Update tests and run them.

