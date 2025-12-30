# Task: Enforce strict agent PR workflow checks in CI

## 0. Meta

- Date: 2025-12-30
- Owner: alex-nazarov
- PR: https://github.com/holiber/barducks/pull/99

## 1. Context

We want Cursor Cloud agents to follow a strict, stage-by-stage PR workflow that is enforced by CI (not just documentation). The strict rules must apply only to agent PRs and must not penalize human PRs.

## 2. What changed

- Added a CI checker that validates the strict agent PR workflow rules (stages, required sections, checkpoints, stage monotonicity, and the single status comment marker/state machine) for PR titles starting with `[🦆 ...]`.
- Wired the checker into the existing PR workflow so it runs on PR events with minimal permissions.
- Reorganized LLM-facing docs into `docs/for-llm-devs/` and updated references.

## 3. How to verify

1. Open PR: https://github.com/holiber/barducks/pull/99
2. Confirm the “Follow Guidelines” workflow is triggered on PR updates.
3. For a non-agent PR title (not starting with `[🦆 ...]`), confirm the strict agent checks are skipped.
4. For an agent PR title (starting with `[🦆 ...]`), confirm CI fails with clear error messages if:
   - no new task file is added,
   - Stage/sections/checkpoints are inconsistent,
   - there is not exactly one status comment containing `<!-- barducks-agent-status -->`.

