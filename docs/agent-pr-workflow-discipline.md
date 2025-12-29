# Agent PR workflow discipline (barducks 🦆)

## 0. Meta

- Date: 2025-12-29
- Agent: 🦆 AgentMallard
- Branch: `cursor/agent-pr-workflow-discipline-afe1`
- PR: https://github.com/holiber/barducks/pull/88
- Related:
  - `docs/agent-workflow.md`
  - `docs/_task-template.md`
  - `docs/tasks/2025-12-29-agent-pr-workflow-discipline.md`

## 1. Task

### What to do

- Standardize Cursor Cloud Agent behavior for a **single-task** PR workflow (one task = one branch + one PR).
- Require stage-by-stage progress visibility:
  - mandatory commit/push checkpoints after key stages
  - a single PR “service status comment” that is edited in-place (no spam)
  - a single task report doc `docs/<short-task-name>.md`
- Provide repo artifacts so agents can follow mechanically:
  - official docs (`docs/agent-workflow.md`)
  - task doc template (`docs/_task-template.md`)
  - Cursor rules (`.cursor/rules/*`) that are always applied

### Definition of Done (acceptance criteria)

- A strict, explicit Stage 0–6 workflow is described in an always-applied Cursor rule.
- `docs/agent-workflow.md` contains:
  - the allowed status state machine
  - a copy/paste service comment template with `<!-- barducks-agent-status -->`
  - guidance for editing the single comment (not creating new ones)
- `docs/_task-template.md` exists and matches Stage 0 → Stage 1 transition (Intake → Task).
- Repo-specific CI requirements are documented for agents (task file under `docs/tasks/` + `CHANGELOG.md` update).
- CI is green on this PR.

### Out of scope

- Implementing a custom GitHub Action/bot to enforce the workflow server-side.
- Changing the repository CI rules themselves beyond documenting them.

## 2. Status Log

- 2025-12-29 — Added initial docs/rules, then CI failed on **Follow Guidelines** because the PR didn’t add `docs/tasks/YYYY-MM-DD-*.md`.
- 2025-12-29 — Fixed CI prerequisites by adding a task file under `docs/tasks/` and updating `CHANGELOG.md`. CI became green.
- 2025-12-29 — Strengthened `.cursor/rules/barducks-agent-workflow.md` to include the full Stage 0–6 checklist directly (not only a link).
- 2025-12-29 — Tried to update PR title and post the single service status comment via `gh`, but GitHub API returned `403 Resource not accessible by integration`. This environment token can’t edit PR metadata or create comments; status-comment automation requires higher permissions.

## 3. Plan

1. Add official workflow docs and task template.
2. Add always-apply Cursor rule that embeds the Stage 0–6 checklist and the allowed statuses.
3. Document repo-specific CI requirements for agents (Follow Guidelines).
4. Verify CI is green.

## 4. Implementation Notes

- Enforcement lives in `.cursor/rules/barducks-agent-workflow.md` with `alwaysApply: true` so agents see the staged process by default.
- `docs/agent-workflow.md` remains the longer reference and includes copy/paste-friendly `gh` commands for maintaining a single service comment.
- CI “Follow Guidelines” requirements are easy for agents to miss, so they are duplicated in both the enforcement rule and the official workflow doc.

## 5. CI Attempts

### Attempt 1/5

- What failed: **Follow Guidelines** — missing a new task file under `docs/tasks/YYYY-MM-DD-*.md`.
- What I changed: Added `docs/tasks/2025-12-29-agent-pr-workflow-discipline.md` and updated `CHANGELOG.md`.
- Links:
  - Failed run: https://github.com/holiber/barducks/actions/runs/20581213682
  - Successful runs:
    - https://github.com/holiber/barducks/actions/runs/20581369061
    - https://github.com/holiber/barducks/actions/runs/20581369070

## 6. Final Report

### What changed

- Added strict barducks PR workflow documentation and templates:
  - `docs/agent-workflow.md`
  - `docs/_task-template.md`
  - `docs/agent-pr-workflow-discipline.md` (this example task doc)
- Added an always-applied Cursor rule embedding the full Stage 0–6 execution checklist:
  - `.cursor/rules/barducks-agent-workflow.md`
- Documented and integrated repo-specific CI requirements (Follow Guidelines) into the workflow docs and rules.

### How to verify

- Open `docs/agent-workflow.md` and confirm:
  - allowed statuses list matches the required state machine
  - the service status comment template includes `<!-- barducks-agent-status -->`
  - the workflow is described Stage 0–6
- Open `.cursor/rules/barducks-agent-workflow.md` and confirm:
  - it is `alwaysApply: true`
  - it embeds the Stage 0–6 checklist directly
  - it includes repo CI requirements (docs/tasks + CHANGELOG)
- Check CI on the PR is green.

### Risks / Follow-ups

- Cursor agents may still ignore rules; server-side enforcement would require a GitHub Action/bot (out of scope here).

