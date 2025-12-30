# Task: Installer extension + core-tag auto-install

## 0. Meta

- Date: 2025-12-30
- Agent: GPT-5.2
- Branch: <branch-name>
- PR: <link>
- Related: <none>

## 1. Task

### What to do

- Add a new `installer` extension (tagged `core`) that abstracts installing projects/repos from different sources.
- Ensure extensions tagged `core` are installed automatically (not required in `workspace.config.yml`).
- Ship at least one provider with `installer`: `installer-fs-provider` (local filesystem).
- Add `installer-git-provider` inside `git` module (Git remotes).

### Definition of Done (acceptance criteria)

- `installer` module exposes `pickProviderForSrc(src)` and `install(src, dest, force)` through unified API (`api-cli`).
- `installer-fs-provider` accepts local directory sources and installs by copying; on re-install, detects changes in `dest` and errors with a list.
- `installer-git-provider` accepts supported GitHub/GitLab URLs and `git@...` SSH remotes; installs via `git clone`; on re-install, errors on dirty working tree.
- Any module with `tags: [core]` is auto-included by the installer even if not listed in workspace config.
- Unit tests cover core-tag auto-include and provider picking.

### Out of scope

- Secret `ya-arc` provider implementation and any references/links to internal infrastructure.
- Rewriting existing workspace project installation flow to use `installer` end-to-end (follow-up task).

## 2. Status Log

- 2025-12-30 14:20 — Created task doc after implementing code; next step is to open PR and align commit history with workflow rules.

## 3. Plan

1. Create a branch and commit task doc (bootstrap commit).
2. Open PR and add single service status comment.
3. Commit implementation changes and tests.
4. Ensure tests pass locally.
5. Finalize report in this doc and update service comment.

## 4. Implementation Notes

- Auto-install for `core` tag is implemented in module dependency resolution: modules whose `MODULE.md` includes `tags: [core]` are injected automatically.
- `installer` router does multi-provider discovery and picks the first provider whose `isValidSrc(src)` returns true.
- `installer-fs-provider` uses directory copy and detects changes by comparing path lists and file mtimes (simple heuristic; can be improved later).
- `installer-git-provider` detects changes via `git status --porcelain` and installs via `git clone`.

## 5. CI Attempts

> N/A (not run yet in PR context).

## 6. Final Report

### What changed

- Added `installer` module (tagged `core`) with `pickProviderForSrc` and `install`.
- Added `installer-fs-provider` and `installer-git-provider`.
- Made `core`-tagged modules auto-included during module resolution.
- Added unit tests for core-tag auto-include and provider selection.

### How to verify

- Run unit tests: `npm run test:unit`
- Check provider picking:
  - `api-cli installer.pickProviderForSrc --src ~/some-local-dir`
  - `api-cli installer.pickProviderForSrc --src https://github.com/owner/repo.git`

### Risks / Follow-ups

- `installer-fs-provider` change detection is mtime-based and may produce false positives/negatives on some filesystems; consider hashing or inode-based strategies.
- Wire `installer.install(...)` into the workspace/project installation pipeline as a follow-up to reduce installer complexity further.

