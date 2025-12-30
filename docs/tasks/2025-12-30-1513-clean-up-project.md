# Task: Clean up the project

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 GPT-5.2
- Branch: chore/clean-up-project-2025-12-30
- PR: https://github.com/holiber/barducks/pull/116
- Related: <none>

## 1. Intake

The working tree contains a set of tracked files that were removed locally. The goal of this PR is to incorporate those removals as an intentional cleanup change and ship it as a single reviewable PR with a short report and verification steps.

## 2. Status Log

- 2025-12-30 15:13 — Creating PR to remove a set of tracked files as requested.

## 3. Plan

1. Create PR with this task doc (CI requirement).
2. Commit file removals.
3. Push and ensure unit tests pass.

## 4. Implementation Notes

- This change is intentionally limited to deleting files (no refactors).

## 5. CI Attempts

> N/A

## 6. Final Report

### What changed

- Deleted a set of tracked files as part of repository cleanup:
  - `docs/workspace-and-extensions.md`
  - `extensions/evolution/MODULE.md`
  - `extensions/evolution/rules/architecture.md`
  - `extensions/evolution/rules/evolution-workflow.md`
  - `extensions/plan/MODULE.md`
  - `extensions/plan/commands/plan.md`
  - `extensions/plan/scripts/plan-finalize.ts`
  - `extensions/plan/scripts/plan-generate.ts`
  - `extensions/plan/scripts/plan-status.ts`
  - `extensions/plan/scripts/plan.js`
  - `extensions/plan/scripts/plan.ts`
  - `media/841B125C-B9C6-40C2-8316-A87167F078E5.jpeg`
  - `todo/test-coverage-gaps-2025-12-30.md`

### How to verify

- Run: `npm run test:unit`
- Ensure removed files are no longer present in the repo tree.

### Risks / Follow-ups

- If any of the deleted docs/scripts are still referenced elsewhere, follow-up fixes may be needed.

