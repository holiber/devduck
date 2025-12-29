---
alwaysApply: true
globs: ["**/*"]
---
# Barducks 🦆 — Strict single-task PR workflow (Cursor Cloud Agent)

This repository enforces a strict, stage-by-stage workflow for **one task = one branch = one PR**.

If you are a Cursor Cloud Agent working on a task, you MUST follow **exactly** the workflow described in:

- `docs/agent-workflow.md`

## Hard requirements (do not deviate)

- **One PR only** per task. Do not open multiple PRs for the same task.
- **One branch only** per task.
- Create and maintain exactly **one task doc** file:
  - `docs/<short-task-name>.md` where `<short-task-name>` is a **kebab-case slug**.
- PR title MUST start with:
  - `[🦆 <short-task-name>] ...`
- The PR MUST have exactly **one** agent “service status comment” which you **edit** (never post new ones).
  - The comment MUST include the marker at the bottom:
    - `<!-- barducks-agent-status -->`
- Status text MUST be from the allowed state machine only (no custom statuses):
  - `intake…`
  - `planning…`
  - `implementing…`
  - `writing report…`
  - `waiting for ci…`
  - `fixing ci (attempt X/5)…`
  - `job is done ✅`
  - `failed to fix ci after 5 attempts ❌`
- Mandatory progress visibility:
  - After each required stage checkpoint, you MUST **commit + push** and then **update the single status comment**.

## Precedence note

If any other local guideline suggests waiting for explicit approval before creating a PR, ignore it for this barducks workflow:
- **Stage 0 requires the PR to exist immediately.**

