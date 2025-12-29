# Barducks 🦆 — Strict PR workflow for Cursor Cloud Agent

This document defines a strict **single-task** workflow for Cursor Cloud Agent work:

- One task = **one branch** + **one PR**
- Visible progress via **required commits/pushes**
- Exactly **one** agent “service status comment” in the PR (edited in-place, no spam)
- Exactly **one** task report file: `docs/<short-task-name>.md`

This is **not** a task queue system. It is execution discipline for one task.

## Definitions & artifacts

### 1) Task doc

For every task, create and maintain:

- `docs/<short-task-name>.md`

Where `<short-task-name>` is a kebab-case slug (example: `ci-pr-workflow-discipline`).

Use `docs/_task-template.md` as the starting point.

### 2) Single service status comment (PR)

There MUST be exactly **one** comment authored by the agent that is continuously updated.

It MUST contain:

- Agent name with 🦆 (example: `🦆 AgentMallard`)
- A shields.io badge reflecting the current allowed status
- 1–2 short paragraphs: what is done in this step + what is next
- A link to `docs/<short-task-name>.md`
- The required marker at the bottom:

`<!-- barducks-agent-status -->`

### 3) Allowed statuses (state machine)

Use **only** these statuses (exact text, including ellipsis/emoji):

- `intake…`
- `planning…`
- `implementing…`
- `writing report…`
- `waiting for ci…`
- `fixing ci (attempt X/5)…`
- `job is done ✅`
- `failed to fix ci after 5 attempts ❌`

## The workflow (stage-by-stage)

## Repo-specific CI requirements (Follow Guidelines)

This repository’s CI will fail (**Follow Guidelines**) unless your PR:

- Adds at least one new task file: `docs/tasks/YYYY-MM-DD-*.md`
- Updates the root `CHANGELOG.md`

These requirements are documented in `CONTRIBUTING.md`.

### Stage 0 — Start / Bootstrap PR (PR must appear immediately)

Goal: as soon as the agent receives the task, the PR exists and shows “work in progress”.

Checklist:

1. Generate `<short-task-name>` (kebab-case slug).
2. Create `docs/<short-task-name>.md` with a minimal skeleton:
   - `# <title>`
   - `## 0. Meta` (date, agent 🦆, links/ids if any)
   - `## 1. Intake` (2–5 sentences: how you understood the task)
   - `## 2. Status Log` (empty)
3. Commit + push **only this file**.
4. Create the PR immediately:
   - Title: `[🦆 <short-task-name>] <human title>`
   - Description: link to `docs/<short-task-name>.md`
5. Create the single service status comment and set status to `intake…`.

Hard rule: Stage 0 MUST end with **PR created** + **service status comment present**.

Note: CI may be red after Stage 0 until you also satisfy the repo-specific requirements above.

### Stage 1 — Clarify Task

Goal: the task becomes concrete and verifiable.

Checklist:

1. In the task doc, replace `## 1. Intake` with `## 1. Task` containing:
   - What needs to be done
   - Definition of Done (acceptance criteria)
   - Out of scope
2. Commit + push.
3. Update service comment:
   - Status: `planning…`
   - Text: “Task clarified; next I’m writing the plan.”

### Stage 2 — Plan

Goal: the plan is visible as a distinct PR update.

Checklist:

1. Add `## 3. Plan` with ordered steps.
2. Commit + push.
3. Update service comment:
   - Status: `implementing…`
   - Text: “Plan ready; starting implementation.”

### Stage 3 — Implementation + Logging (iterative)

Goal: implementation progresses in batches and difficulties are recorded.

Checklist:

1. Implement the plan.
2. Maintain `## 2. Status Log` (append-only):
   - Incorrect commands
   - API mistakes
   - Dead ends
   - What worked
3. Work in **batches**:
   - After each substantial sub-step: commit + push
   - After each substantial sub-step: update the single service comment

### Stage 4 — Code Complete → `writing report…`

Goal: separate “code is done” from “report is done”.

Checklist:

1. When implementation is complete:
   - Update `## 4. Implementation Notes` (key decisions/trade-offs)
   - Draft `## 6. Final Report` (may omit CI links at this point)
2. Commit + push.
3. Update service comment:
   - Status: `writing report…`

### Stage 5 — Final Report → `waiting for ci…`

Goal: report is pushed, then only CI and fixes remain.

Checklist:

1. Finalize `## 6. Final Report`:
   - What changed
   - How to verify
   - Remaining risks / follow-ups
2. Commit + push.
3. Update service comment:
   - Status: `waiting for ci…`

### Stage 6 — CI loop (mandatory)

Goal: bring CI to green or stop after 5 honest attempts.

If CI is green:

1. Update service comment: `job is done ✅`
2. (Recommended) add the successful CI run link to the task doc.

If CI fails:

For each attempt X (max 5):

1. Update service comment: `fixing ci (attempt X/5)…`
2. Fix the problem.
3. Commit + push.
4. Fill `## 5. CI Attempts` in the task doc:
   - Attempt X/5
   - What failed, what you changed
   - CI run links (if available)
5. Update service comment: `waiting for ci…`
6. Repeat until green or X == 5.

Limit:

- After 5 failed attempts:
  - Update service comment: `failed to fix ci after 5 attempts ❌`
  - Document what remains and why in `## 5. CI Attempts` and `## 6. Final Report`
  - Stop further work on the task

## Minimum required push checkpoints (enforcement)

You MUST push at least these checkpoints (each followed by a service comment update):

1. Stage 0: bootstrap doc + PR
2. Stage 1: clarified Task
3. Stage 2: Plan
4. Stage 3: at least one implementation push (usually more)
5. Stage 4: code complete / pre-report
6. Stage 5: final report
7. Stage 6: each CI fix = separate push

## Service status comment template (copy/paste)

Replace placeholders, keep the marker line unchanged.

```md
🦆 <AgentName>

![barducks status](https://img.shields.io/badge/barducks-<status>-blue)

<1–2 short paragraphs: what I did in this step, and what I’m doing next.>

Task doc: `docs/<short-task-name>.md`

<!-- barducks-agent-status -->
```

Notes:

- The `<status>` in the badge URL MUST be URL-safe (encode spaces and parentheses).
- Example (planning…): `planning%E2%80%A6`

### Badge URL encoding reference

Use these URL-encoded status values:

- `intake…` → `intake%E2%80%A6`
- `planning…` → `planning%E2%80%A6`
- `implementing…` → `implementing%E2%80%A6`
- `writing report…` → `writing%20report%E2%80%A6`
- `waiting for ci…` → `waiting%20for%20ci%E2%80%A6`
- `fixing ci (attempt X/5)…` → `fixing%20ci%20%28attempt%20X%2F5%29%E2%80%A6`
- `job is done ✅` → `job%20is%20done%20%E2%9C%85`
- `failed to fix ci after 5 attempts ❌` → `failed%20to%20fix%20ci%20after%205%20attempts%20%E2%9D%8C`

## How to update the single comment (GitHub CLI)

The agent must update (edit) the existing comment containing the marker:

`<!-- barducks-agent-status -->`

### Required GitHub permissions

To follow this workflow fully, the agent must have permission to:

- Create PR comments
- Edit existing PR comments

If GitHub returns `403 Resource not accessible by integration`, the token/integration used by the agent does not have sufficient permissions. Fix the permissions for the agent identity (bot/app/token) used by `gh` in your environment.

Suggested approach (copy/paste-friendly):

1. Find the PR number:

```bash
gh pr view --json number --jq .number
```

2. Find the comment id that contains the marker (there MUST be exactly one):

```bash
OWNER="$(gh repo view --json owner --jq .owner.login)"
REPO="$(gh repo view --json name --jq .name)"
PR_NUMBER="$(gh pr view --json number --jq .number)"

gh api "repos/$OWNER/$REPO/issues/$PR_NUMBER/comments" --paginate \
  --jq '.[] | select(.body | contains("<!-- barducks-agent-status -->")) | .id'
```

3. If no comment exists yet, create it once (Stage 0) and then only edit:

```bash
gh pr comment "$PR_NUMBER" --body "$(cat <<'EOF'
🦆 <AgentName>

![barducks status](https://img.shields.io/badge/barducks-intake%E2%80%A6-blue)

Bootstrapped task doc + opened PR. Next: clarify the task into a verifiable DoD and write a short plan.

Task doc: `docs/<short-task-name>.md`

<!-- barducks-agent-status -->
EOF
)"
```

4. PATCH the existing comment body (all later updates):

```bash
COMMENT_ID="<id from step 2>"

gh api "repos/$OWNER/$REPO/issues/comments/$COMMENT_ID" -X PATCH \
  -f body="$(cat <<'EOF'
🦆 <AgentName>

![barducks status](https://img.shields.io/badge/barducks-planning%E2%80%A6-blue)

Clarified the task and wrote concrete acceptance criteria in the task doc. Next: write an ordered implementation plan and start coding in small batches.

Task doc: `docs/<short-task-name>.md`

<!-- barducks-agent-status -->
EOF
)"
```

Implementation details depend on repo/PR number; keep the invariant: **exactly one** comment contains the marker, and it is the one being updated.

