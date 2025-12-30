# Task: Prevent `smogchecked.txt` from polluting workspace root

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 GPT-5.2
- Branch: cursor/unwanted-smogchecked-txt-file-cd4b
- PR: (not created from this environment)
- Related: User report — `smogchecked.txt` appears in workspace unexpectedly

## 1. Intake

`smogchecked.txt` appears in the workspace root after running installer/tests. This is unexpected workspace pollution; we should identify the writer and update the behavior so tests and installer hooks do not create stray files in the workspace root.

## 2. Status Log

- 2025-12-30 — Found `tests/installer/installer-unattended.pw.spec.ts` creating an external test extension whose `post-install` hook writes `smogchecked.txt` to `ctx.workspaceRoot`. Updated the test so the hook writes to `ctx.cacheDir` instead.

## 3. Plan

1. Locate any code/test paths that create `smogchecked.txt`.
2. Change tests so marker files are written under `.cache/` (or other temp dirs), not workspace root.
3. Run unit/e2e tests to ensure behavior remains correct.

## 4. Implementation Notes

- Updated the installer test’s generated `hooks.js` to write `smogchecked.txt` under `ctx.cacheDir` (i.e., `<workspace>/.cache/devduck/`), avoiding workspace root pollution.

## 5. CI Attempts

N/A (no CI runs from this environment).

## 6. Final Report

### What changed

- Adjusted installer Playwright test so the generated smogcheck hook writes `smogchecked.txt` to the workspace cache directory instead of workspace root.

### How to verify

- Run unit tests: `npm run test:unit`
- Run installer Playwright suite: `npm run test:installer:pw`

### Risks / Follow-ups

- If other tests/hooks write to workspace root, they should be migrated to `.cache/` or a temp dir as well.

