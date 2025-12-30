
---

```md
# Task: Enforce strict stage-by-stage PR workflow for Cursor Cloud Agents (barducks 🦆)

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 <AgentName>
- Stage: 0
- Branch: <branch-name>
- PR: <link or #number>

## 1. Introduction (What & Why)

### What we are building

We are implementing a **strict, CI-enforced, stage-by-stage workflow** for
Cursor Cloud AI agents working in this repository.

Each agent works on **one task = one branch = one PR**, and must:

- create a PR immediately,
- progress through clearly defined stages,
- push changes after every stage checkpoint,
- maintain a structured task log and report,
- keep exactly one continuously-updated PR status comment,
- handle CI failures with a limited retry loop.

### Why this is needed

Cursor Cloud agents **do not reliably follow written instructions alone**.
In practice they often:

- skip stages,
- forget to push intermediate progress,
- update code without updating status,
- collapse the entire task into one large commit,
- or ignore reporting requirements.

To make agent behavior **predictable, observable, and auditable**, we must
enforce the workflow at the **CI level**, not just via documentation.

### Design principles

- **Hard enforcement beats guidelines**  
  If a rule is important, CI must fail when it is violated.

- **Humans should not be penalized**  
  The strict workflow applies **only** to AI agent PRs.

- **Stages must be machine-checkable**  
  CI must be able to determine:
  - the current stage,
  - whether earlier stages were completed,
  - whether required pushes happened.

---

## 2. Scope of Enforcement

### Agent PR detection

A PR is considered an **agent PR** if and only if its title starts with:

```

[🦆 <short-task-name>] ...

```

All strict checks apply **only** to such PRs.

Human PRs continue to follow the existing, lighter guidelines.

### Task file convention

Each agent PR must add **exactly one** new task file:

```

docs/tasks/YYYY-MM-DD-HHMM-<short-task-name>.md

```

This file is the **single source of truth** for:

- task definition,
- progress tracking,
- stage state,
- CI attempts,
- final report.

---

## 3. Stage Model (Authoritative)

The workflow consists of **exactly seven stages**, executed in order.
All of them **must be implemented and enforced**.

| Stage | Name | Meaning |
|------:|------|--------|
| 0 | Intake | PR bootstrap + initial understanding |
| 1 | Task | Task clarified with acceptance criteria |
| 2 | Plan | Explicit implementation plan written |
| 3 | Implementation | Work in progress, logged |
| 4 | Code Complete | Implementation finished |
| 5 | Final Report | Final report written |
| 6 | CI Loop | CI success or capped failure |

### Stage declaration (mandatory)

The current stage is declared in the task file under `## 0. Meta`:

```

* Stage: N

```

Where `N` is an integer from `0` to `6`.

Stages are **monotonic**:
- the stage number may only increase,
- skipping stages is forbidden.

---

## 4. Mandatory Stage Checkpoints (Push Enforcement)

To ensure that agents **actually push after each stage**, we introduce
explicit checkpoints.

In section `## 2. Status Log`, the agent must append:

```

* CHECKPOINT: Stage 0 pushed
* CHECKPOINT: Stage 1 pushed
  ...

```

### Enforcement rule

If the task file declares:

```

* Stage: N

```

then the Status Log **must contain all checkpoints**:

```

Stage 0 pushed
Stage 1 pushed
...
Stage N pushed

```

If any checkpoint is missing → CI **must fail**.

This transforms “remember to push” into a hard, verifiable contract.

---

## 5. Required Task File Structure (by Stage)

### Always required (all stages)

- `## 0. Meta`
- `## 2. Status Log`

---

### Stage ≥ 1 — Task defined

Must contain:

- `## 1. Task`

Must NOT contain:

- `## 1. Intake`

---

### Stage ≥ 2 — Plan defined

Must contain:

- `## 3. Plan`

---

### Stage ≥ 4 — Code complete

Must contain:

- `## 4. Implementation Notes`

---

### Stage ≥ 5 — Report complete

Must contain:

- `## 6. Final Report`

---

### Stage 6 — CI loop

If CI failures occurred, must contain:

- `## 5. CI Attempts`

---

## 6. PR Service Status Comment (Mandatory)

Each agent PR must contain **exactly one** service status comment.

### Identification

The comment must contain this marker:

```

<!-- barducks-agent-status -->

```

CI must fail if:
- zero such comments exist,
- more than one such comment exists.

### Status state machine (exact text)

The comment must use one of the following statuses:

- `intake…`
- `planning…`
- `implementing…`
- `writing report…`
- `waiting for ci…`
- `fixing ci (attempt X/5)…`
- `job is done ✅`
- `failed to fix ci after 5 attempts ❌`

---

## 7. CI Loop Rules (Stage 6)

### Success path

- CI passes
- Status becomes: `job is done ✅`

### Failure path

For each failure:

1. Status → `fixing ci (attempt X/5)…`
2. Fix is committed and pushed
3. CI reruns
4. Attempt is logged in `## 5. CI Attempts`

### Hard limit

- Maximum **5 attempts**
- After 5 failures:
  - Status → `failed to fix ci after 5 attempts ❌`
  - Agent must stop further work

---

## 8. Required CI Enforcement (Implementation Deliverable)

The implementation MUST include a GitHub Actions check that enforces **all**
rules described above.

### The check MUST verify

1. PR is an agent PR (`[🦆 ...]`)
2. Exactly one task file added under `docs/tasks/`
3. Valid `Stage: 0..6`
4. All required sections for the declared stage
5. All required checkpoints for the declared stage
6. Exactly one PR comment containing:
```

   <!-- barducks-agent-status -->

````

### Permissions required

```yaml
permissions:
contents: read
pull-requests: read
````

### Failure behavior

On violation, CI must fail with a **clear, actionable error message** explaining:

* which rule was violated,
* which stage is inconsistent,
* what must be added or fixed.

---

## 9. Final Verification Checklist (Agent Self-Check)

Before declaring `job is done ✅`, the agent MUST verify:

* [ ] All stages 0 → 6 are implemented and enforced
* [ ] Agent PR detection works correctly
* [ ] Human PRs are unaffected
* [ ] Task file structure is fully enforced
* [ ] Stage monotonicity is enforced
* [ ] Checkpoints are required and validated
* [ ] Exactly one service status comment is required
* [ ] CI failure retry limit is enforced

---

## 10. Example: Correct Final Task File (Stage 6)

The full example task file is here: [`docs/for-llm-devs/llm-dev-taskfile-example.md`](docs/for-llm-devs/llm-dev-taskfile-example.md)

Great — this is a very important addition.
Below is an **updated final example task file (Stage 6)** that includes:

* ✅ **CI Attempts with real attempts**
* ⚠️ **A scenario where the agent requires user help**
* the preserved **Intake**
* **Journal (Captain’s Log)**
* **Recommendation**
* a structure that is convenient for both agents and humans

This example can be treated as a **golden reference** and can be directly referenced from `docs/for-llm-devs/agent-workflow.md`.

---

## 10. Example: Correct Final Task File (Stage 6)
