# Task: README badges text + logo path fix

## 0. Meta

- Date: 2025-12-29
- Agent: 🦆 GPT-5.2
- Branch: cursor/readme-badge-and-logo-061c
- PR: (pending)
- Related: `docs/tasks/2025-12-30-0034-after-merge-ci-workflow-name-and-badge.md`, `docs/tasks/2025-12-30-0048-project-stats-badge.md`, `docs/tasks/2025-12-30-0040-readme-logo-rounded.md`

## 1. Task

### What to do

- Update the first README badge so it shows only the two words: `tests` and `passing`/`failing`.
- Update the project stats badge so it shows only the phrase `project stats`.
- Fix the README logo image path so it points to the correct file.
- Do not rename any GitHub Actions workflows.

### Definition of Done (acceptance criteria)

- README first badge renders as `tests` + `passing`/`failing` without including a workflow name.
- `metrics/project-stats.svg` renders a single-phrase badge with only `project stats`.
- README logo image reference matches an existing file path in `media/`.
- No workflow `name:` values are modified.

### Out of scope

- Changing workflow names or CI configuration beyond what is needed for badge rendering.

## 2. Status Log

- 2025-12-29 — Updated README to use a shields.io workflow status badge labeled `tests`, and fixed logo filename casing.
- 2025-12-29 — Updated the metrics report generator to emit a single-phrase `project stats` SVG badge.

## 3. Plan

1. Change README badges and logo path.
2. Change SVG badge generator to support a single-phrase badge.
3. Ensure the badges still point at the same workflows/paths and do not require workflow renames.

## 4. Implementation Notes

- The default GitHub Actions badge uses the workflow name as its visible label; switching to a shields.io workflow status badge allows setting the label to exactly `tests`.
- The `project-stats.svg` badge is generated during metrics report creation; generating it as a single-segment badge ensures it displays only `project stats`.

## 6. Final Report

### What changed

- README tests badge now uses shields.io with label `tests`.
- Project stats badge SVG now renders as a single-phrase badge (`project stats` only).
- README logo path now matches `media/barducks-logo-rounded.PNG`.

### How to verify

- Open `README.md` and confirm:
  - The first badge reads `tests` and the status word (`passing`/`failing`).
  - The second badge reads only `project stats`.
  - The logo renders.
- After CI runs:
  - Confirm GitHub Pages serves the updated `metrics/project-stats.svg`.
