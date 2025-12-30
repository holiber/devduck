# Task: Stop requiring CHANGELOG.md updates in every PR

## Summary

Remove the repository rule that forces updating the root `CHANGELOG.md` in every pull request. Keep per-PR logging in `docs/tasks/` and assemble the release changelog before publishing a new version.

## Rationale

- Updating `CHANGELOG.md` in every PR creates frequent merge conflicts, especially with parallel work.
- We already require a task file per PR under `docs/tasks/`, which provides traceability and change context.
- A curated changelog is more reliable when assembled during release preparation.

## Scope

- Remove the CI merge check that requires `CHANGELOG.md` changes on every PR.
- Update contributor documentation to match the new policy.

