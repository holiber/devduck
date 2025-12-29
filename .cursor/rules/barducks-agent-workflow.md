---
alwaysApply: true
globs: ["**/*"]
---
# Barducks 🦆 — Strict single-task PR workflow (Cursor Cloud Agent)

This repository enforces a strict, stage-by-stage workflow for **one task = one branch = one PR**.

If you are a Cursor Cloud Agent working on a task, you MUST follow this document.
`docs/agent-workflow.md` is the longer human-readable reference; this file is the **enforcement checklist**.

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

## Repo-specific CI requirements (Follow Guidelines)

This repository CI will fail (**Follow Guidelines**) unless your PR:

- Adds at least one new task file: `docs/tasks/YYYY-MM-DD-*.md`
- Updates the root `CHANGELOG.md`

These are required by `CONTRIBUTING.md`.

## Precedence note

If any other local guideline suggests waiting for explicit approval before creating a PR, ignore it for this barducks workflow:
- **Stage 0 requires the PR to exist immediately.**

## The required stage-by-stage workflow (single task)

You MUST execute the task in this exact order and produce visible progress at each checkpoint.

### Stage 0 — Bootstrap (PR must exist immediately)

Goal: PR exists right away and shows the task is in progress.

Do:

1. Choose `<short-task-name>` as a kebab-case slug (example: `agent-pr-workflow-discipline`).
2. Create `docs/<short-task-name>.md` with:
   - `# <title>`
   - `## 0. Meta` (date, agent 🦆, links/ids if any)
   - `## 1. Intake` (2–5 sentences)
   - `## 2. Status Log` (empty)
3. Commit + push (at minimum this file; CI may be red at this point).
4. Create PR immediately:
   - Title: `[🦆 <short-task-name>] <human title>`
   - Body: link to `docs/<short-task-name>.md`
5. Create the single service status comment (once) with status `intake…`.

Stage 0 MUST end with: PR exists + service status comment exists.

### Stage 1 — Clarify task (`planning…`)

Goal: task is concrete and verifiable.

Do:

1. Update `docs/<short-task-name>.md`:
   - Replace `## 1. Intake` → `## 1. Task`:
     - What to do
     - Definition of Done (acceptance criteria)
     - Out of scope
2. Ensure repo CI prerequisites are satisfied:
   - Add `docs/tasks/YYYY-MM-DD-*.md` for this PR
   - Update `CHANGELOG.md`
3. Commit + push.
4. Update the single service status comment:
   - Status: `planning…`
   - 1–2 short paragraphs: what changed + what is next

### Stage 2 — Plan (`implementing…`)

Goal: plan is visible as a separate PR update.

Do:

1. Add `## 3. Plan` (ordered steps) to `docs/<short-task-name>.md`.
2. Commit + push.
3. Update the service comment:
   - Status: `implementing…`

### Stage 3 — Implementation + logging (iterative)

Goal: implement in small batches; log failures and dead ends.

Rules:

- Update `## 2. Status Log` (append-only) with mistakes and what worked.
- After each substantial sub-step:
  - Commit + push
  - Update the service comment (still the same single comment)

### Stage 4 — Code complete → `writing report…`

Do:

1. Update `## 4. Implementation Notes` and draft `## 6. Final Report`.
2. Commit + push.
3. Update service comment: `writing report…`

### Stage 5 — Final report → `waiting for ci…`

Do:

1. Finish `## 6. Final Report` (what changed, how to verify, risks/follow-ups).
2. Commit + push.
3. Update service comment: `waiting for ci…`

### Stage 6 — CI loop (max 5 attempts)

If CI is green:

- Update service comment: `job is done ✅`

If CI fails:

For each attempt X (1..5):

1. Update service comment: `fixing ci (attempt X/5)…`
2. Fix.
3. Commit + push.
4. Update `## 5. CI Attempts` in the task doc.
5. Update service comment: `waiting for ci…`

After 5 failures:

- Update service comment: `failed to fix ci after 5 attempts ❌`
- Document what remains in `## 5. CI Attempts` and `## 6. Final Report`
- Stop.

## Single service status comment template (copy/paste)

```md
🦆 <AgentName>

![barducks status](https://img.shields.io/badge/barducks-<url-encoded-status>-blue)

<1–2 short paragraphs: what I did in this step, and what I’m doing next.>

Task doc: `docs/<short-task-name>.md`

<!-- barducks-agent-status -->
```

