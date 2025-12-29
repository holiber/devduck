# Fork readiness: `holiber/barducks`

## Status

- **Hardcoded links to `holiber/devduck`**: **removed from tracked files** (docs, scripts, tests).
- **CI in a fork**: **updated** to avoid failing on PRs coming from forked repositories (GitHub token permissions limitations).
- **Remaining `holiber/devduck` references**: only in local `.git/*` metadata (not committed/tracked).

## What was changed

### Hardcoded repository references removed

- **`README.md`**
  - Removed the workflow badge that was hardcoded to `holiber/devduck`.
  - Replaced `npx --yes github:holiber/devduck ...` examples with `github:<owner>/<repo>`.
- **`CHANGELOG.md`**
  - Replaced hardcoded `https://github.com/holiber/devduck/pull/...` links with plain `PR #NN` text.
  - Removed hardcoded compare/release link references and converted version headings to plain text.
- **`scripts/barducks-cli.ts`**
  - Updated the default `--devduck-repo` from `holiber/devduck` to `holiber/barducks` (so `devduck new ...` clones the fork by default).
- **`modules/vcs/commands/new.md`**
  - Replaced the `git:github.com/holiber/devduck` example with `git:github.com/<owner>/<repo>`.
- **Installer docs/comments**
  - Generalized examples like `github.com/holiber/devduck` to `github.com/<owner>/<repo>` in:
    - `scripts/install/installer-utils.ts`
    - `scripts/install/install-project-scripts.ts`
- **GitHub provider tests**
  - Removed hardcoded live issue references to `holiber/devduck`.
  - The “live GitHub API” tests now only run when both are set:
    - `GITHUB_TOKEN`
    - `GITHUB_TEST_ISSUE_ID` **or** `GITHUB_TEST_ISSUE_URL`

### CI fork-safety improvements

- **`.github/workflows/ci.yml`**
  - All PR comment steps (find/create/update the metrics comment) now run only when:
    - `github.event.pull_request.head.repo.full_name == github.repository`
  - This prevents common failures on PRs opened from forks, where `GITHUB_TOKEN` is read-only and cannot write PR comments.

## Recommendations for the fork

- **Decide what should be “canonical”**
  - If `holiber/barducks` is the long-term canonical repo, keep the new default in `scripts/barducks-cli.ts`.
  - If you plan to rename the project and/or publish it elsewhere later, consider making `--devduck-repo` default configurable via an env var (so future forks don’t need code changes).

- **GitHub Actions permissions**
  - For PRs created from branches inside the same repo, the PR metrics comment should work.
  - For PRs created from external forks, PR commenting will be skipped (by design, to keep CI green).

- **Optional: enable GitHub Pages**
  - The workflow deploys the metrics dashboard to `gh-pages` on successful `main` pushes.
  - If you want the dashboard link to work, enable GitHub Pages for the repository (or keep it disabled—CI will still run).

- **Optional: provide a test issue for GitHub provider integration tests**
  - If you want CI (or local) to run the live GitHub provider tests, set:
    - `GITHUB_TOKEN`
    - `GITHUB_TEST_ISSUE_ID` (format: `owner/repo#123`) or `GITHUB_TEST_ISSUE_URL`

