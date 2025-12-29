# Contributing to DevDuck

## Pull request requirements

Every pull request **must** include:

1. A **task file** under `docs/tasks/` describing the change (or linking to an external ticket).
   - File name format: `docs/tasks/YYYY-MM-DD-short-description.md`
   - The PR must add at least one new file matching `docs/tasks/YYYY-MM-DD-*.md`
2. An update to the root **`CHANGELOG.md`**

Pull requests missing either requirement will fail CI (**Follow Guidelines**).

## Tips

- Keep PRs focused and small (one logical change).
- Run `npm test` locally before pushing.

