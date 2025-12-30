# Contributing to Barducks

## Pull request requirements

Every pull request **must** include:

1. A **task file** under `docs/tasks/` describing the change (or linking to an external ticket).
   - File name format: `docs/tasks/YYYY-MM-DD-short-description.md`
   - The PR must add at least one new file matching `docs/tasks/YYYY-MM-DD-*.md`

Pull requests missing this requirement will fail CI (**Follow Guidelines**).

We no longer require updating `CHANGELOG.md` in every PR (it causes frequent merge conflicts). Instead, `docs/tasks/` is the per-PR log, and the release changelog is assembled before publishing a new version.

## Tips

- Run `npm test` locally before pushing.

## CI notes (facts)

- The PR workflow **enforces** adding a task file under `docs/tasks/` (see `.github/workflows/follow-guidelines.yml`).
- Exception: if the only changed file is `CHANGELOG.md`, CI skips the task-file requirement.
- PR CI runs on Node.js **24**.

