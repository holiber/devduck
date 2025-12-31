# Task: Code duplication (copy/paste) metric audit + refactor recommendations

## 0. Meta

- Date: 2025-12-29
- Agent: Cursor Cloud Agent
- Branch: `cursor/code-duplication-analysis-dc20`
- Related: CI “🧬 Duplication (copy/paste)” metric in PR dashboard comment

## 1. Task

### What to do

- Inspect how CI computes the “copy/paste %” metric.
- Explain why the number is high.
- Provide a refactor plan targeting the main sources of duplication.

### Definition of Done

- The location, tool, and configuration used to compute duplication are documented.
- The meaning of the percentage is explained (what is counted / what is excluded).
- Concrete refactor recommendations are listed, prioritised by impact.

## 2. Findings: how duplication is measured in CI

### Where it is computed

- **Workflow**: `.github/workflows/ci.yml`
  - Runs `node scripts/ci/collect-metrics.mjs` (step “Collect current metrics (no tests)”).
  - The PR comment table renders duplication via `scripts/ci/render-pr-comment-dashboard.mjs`:
    - `🧬 Duplication (copy/paste) | current.quality.duplication.duplicatedPct`

### Tool and data flow

- CI uses **`jscpd`** (dev dependency `jscpd@^4.0.5`).
- `scripts/ci/collect-metrics.mjs` runs `npx jscpd ... --reporters json` and reads the JSON report.
- The metric stored into `current.json` is:
  - `metrics.quality.duplication.duplicatedPct` (a number)
  - `metrics.quality.duplication.duplicatedLines`
  - `metrics.quality.duplication.totalLines`
- `scripts/ci/compare-metrics.mjs` computes the delta vs baseline:
  - `deltas.duplication_pct = current.duplicatedPct - baseline.duplicatedPct`

### What “duplicatedPct” means

`duplicatedPct` is taken from the jscpd report:

- `report.statistics.total.percentage`

For jscpd, this corresponds to “duplicated lines as a percentage of total scanned lines” (reported as a percent, e.g. `8.81` means `8.81%`).

### Important pitfall (why the CI number was extremely high)

`jscpd`’s CLI option `--ignore` accepts **one string** (comma-separated globs).
Passing multiple `--ignore` flags causes the **last one to win**, which can unintentionally include `node_modules/` in CI (because CI runs `npm ci` before collecting metrics).

#### Evidence (local reproduction)

Using the old command style (multiple `--ignore` flags), jscpd scanned `node_modules/` and reported:

- **~41.6% duplicated lines** (thousands of clones; dominated by dependency code).

After switching to a single comma-separated ignore string (and enabling `.gitignore` support), the metric becomes stable and repo-focused:

- **8.81% duplicated lines** (`2699 / 30620` lines; `175` clones across `175` sources)

### Fix applied

`scripts/ci/collect-metrics.mjs` now:

- Uses `--gitignore` to respect `.gitignore` (so `node_modules/` stays excluded).
- Passes a single `--ignore` value with comma-separated globs to avoid the “last flag wins” bug.

## 3. Findings: main duplication hotspots (repo code)

Top duplicated file pairs by total duplicated lines (from the corrected jscpd report):

- `extensions/dashboard/schemas/dashboard-snapshot.zod.ts` ↔ `scripts/schemas/dashboard-snapshot.zod.ts` (**152 lines**, 1:1 copy)
- `extensions/messenger-telegram/providers/telegram-provider/index.ts` ↔ `extensions/messenger-im/providers/im-messenger-provider/index.ts` (**145 lines**)
- `extensions/github-ci/scripts/ci-status.ts` ↔ `extensions/github-ci/scripts/github-ci.ts` (**131 lines**)
- `tests/ci/smogcheck-provider.pw.spec.ts` ↔ `tests/ci/smogcheck-provider.test.ts` (**117 lines**)
- `extensions/ci-github/providers/github-provider/index.ts` ↔ `extensions/issue-tracker-github/providers/github-provider/index.ts` (**84 lines**)
- `scripts/install/install-1-check-env.ts` ↔ `scripts/install/install-4-check-env-again.ts` (**68 lines**)

## 4. Refactor recommendations (prioritised)

### A) Keep the metric honest (immediate, high impact)

- **Keep `.gitignore` + comma-separated ignore globs** for jscpd.
- Optional hardening (if desired):
  - Only scan repo “source” folders: `extensions/**`, `scripts/**`, `tests/**` instead of `**/*.{ts,js,...}`.
  - Add an explicit “docs/config/vendor” exclude list to prevent accidental inflations (e.g. copied fixtures).

### B) Remove 1:1 file copies (quick wins)

- **Dashboard snapshot schema**:
  - There is a direct copy between:
    - `scripts/schemas/dashboard-snapshot.zod.ts`
    - `extensions/dashboard/schemas/dashboard-snapshot.zod.ts`
  - Recommendation: keep a single source of truth and re-export it from the other location (or move it into a shared “core schemas” module used by both).

### C) Introduce shared provider scaffolding for “mock providers” (medium effort, high payoff)

- **Messenger providers** (Telegram vs IM):
  - Both implement the same caching/page-walk pattern (`listChats`, `getChatHistory` paging, `downloadFile` caching).
  - Recommendation: create a shared factory/helper (e.g. `extensions/messenger/providers/mock-provider-kit.ts`) to centralise:
    - env parsing (`envInt`)
    - pagination loop / cursor logic
    - cache key conventions
    - the “no real API yet” error helpers
  - Providers then only provide per-service specifics (ids/prefixes, mock chat list, mock latest number strategy, auth/manifest differences).

- **GitHub API code** duplicated across providers:
  - `extensions/ci-github/providers/github-provider/index.ts`
  - `extensions/issue-tracker-github/providers/github-provider/index.ts`
  - Recommendation: extract shared GitHub primitives into a shared module:
    - `getRepoInfo()` (git remote parsing)
    - token loading and error messages
    - `githubApiGet()` (pagination later if needed)
    - shared DTO → contract mapping utilities

### D) Unify duplicated tests via a shared “conformance suite” (medium effort)

- **`smogcheck-provider` tests** are duplicated between Node’s test runner and Playwright.
- Recommendation:
  - Extract the shared assertions into a single reusable suite module (e.g. `tests/shared/ci-provider-conformance.ts`) that takes a minimal “test adapter” (describe/test/beforeEach), then run it under both harnesses.
  - Alternatively (simpler): pick one harness for provider contract tests and drop the other copy.

### E) Installer step refactor (medium effort)

- **Env check steps** duplicate filtering + reporting:
  - `scripts/install/install-1-check-env.ts`
  - `scripts/install/install-4-check-env-again.ts`
- Recommendation:
  - Factor a shared `runEnvCheck({ stepLabel, workspaceRoot, projectRoot, includeRepos, skipExecutedChecks })` helper.
  - Keep step files thin wrappers to preserve the current UX/messages while avoiding drift between Step 1 and Step 4.

## 5. Notes / follow-ups

- After fixing the ignore handling, the duplication percentage dropped from “dependency-dominated” values to a repo-focused **~8.8%**.
- If you want the metric to reflect only “product code” (not tests), consider excluding `tests/**` and reporting a second metric for tests separately.

