## Task: Add “project stats” badge after merge

### Goal

Ensure the “AFTER MERGE - Tests & Metrics” workflow publishes a **project stats** badge that links to the metrics dashboard hosted on `gh-pages`.

### Implementation

- Generate a small SVG badge at `metrics/project-stats.svg` as part of the metrics report generation.
- Add the badge to `README.md` linking to the GitHub Pages metrics dashboard at `/metrics/`.

### Acceptance criteria

- The README shows a **project stats** badge.
- The badge image is served from GitHub Pages (`gh-pages`) and updates automatically after successful merges to `main`.
- Clicking the badge opens the metrics dashboard page.

