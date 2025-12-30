# Task: Script folder reorganization (scripts → src) and runnable wrappers

## 0. Meta

- Date: 2025-12-29
- Agent: 🦆 Cursor Cloud Agent
- Branch: cursor/script-folder-reorganization-eb7d
- PR: https://github.com/holiber/barducks/pull/97

## 1. Task

### What to do

- Rename the repository `scripts/` folder to `src/`.
- Create a new `scripts/` folder that keeps only scripts runnable directly with Node/tsx/ts-node (no project compilation step).
- Update imports/config/tests so the repository still builds and tests pass.

### Definition of Done (acceptance criteria)

- `src/` contains the former `scripts/` implementation code.
- `scripts/` exists and contains only thin runnable entrypoints that forward to `src/` code.
- `npm run test:unit` passes.
- Playwright installer suite (`npm run test:installer:pw`) passes.
- CI “Follow Guidelines” job passes (task file added).

### Out of scope

- Any functional feature changes unrelated to the folder reorganization.

## 2. Status Log

- 2025-12-29 — Renamed `scripts/` → `src/`, added new runnable `scripts/` wrappers, updated imports/configs/tests, fixed merge conflict with `origin/main`, and re-ran CI-equivalent tests locally.

## 3. Plan

1. Keep `src/` as the main TS source folder (former `scripts/`).
2. Keep `scripts/` as runnable wrappers only.
3. Update references to `scripts/*` paths across repo, and ensure CI paths stay stable.

## 4. Implementation Notes

- `scripts/` wrappers were kept so CI workflows and docs can keep using stable runnable paths like `node scripts/ci/*.mjs` and `tsx scripts/*.ts`, while implementation code lives in `src/`.

## 6. Final Report

### What changed

- Renamed top-level `scripts/` → `src/`.
- Added a new top-level `scripts/` containing only runnable wrappers (entrypoints).
- Updated TypeScript config and internal references to prefer `src/`.

### How to verify

- `npm run test:unit`
- `npm run test:installer:pw`

### Risks / Follow-ups

- If external tooling assumes the old `scripts/` layout, it should use the new `scripts/` wrappers, not deep paths under `src/`.

