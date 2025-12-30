## Brief description of next tasks

- /pr should follow CONTRIBUTING.md
- fix metrics gh page
- fix comparing tests time with baseline
- describe the 3 ways of install and test them

## Test coverage gaps (unit tests, c8, 2025-12-30)

- Total coverage (unit suite): **63.54% lines**, **61.33% branches**, **65.11% functions**
- Highest-risk low-coverage modules (prioritized for follow-up tests):
  - `src/lib/repo-modules.ts` (**23.18% lines**, **25% branches**): repo URL parsing (`git@`, `https://`, `github.com/...`, `arc://`), symlink behavior, clone/pull flows, version gating via `barducks.manifest.json`.
  - `src/lib/api/mcp.ts` (**26.94% lines**): spawning MCP servers, stdio JSON-RPC framing, timeouts, error propagation, and ensuring processes are cleaned up.
  - `src/install/mcp.ts` (**45.33% lines**, **28.57% branches**): generating `.cursor/mcp.json` from checks + `.env`, optional vs required servers, URL checks/timeout semantics, command discovery (`command -v`, `which`, `~` expansion).
  - `src/barducks-cli.ts` (**26.92% lines**, **40% branches**): `new` workspace flow, filesystem writes, `INIT_CWD` path resolution, and robust handling of `git`/`npm install` failures.
  - Integration-heavy providers with very low unit coverage (likely needs fixture-based tests rather than live credentials):
    - `extensions/issue-tracker-github/providers/github-provider/index.ts` (**19.15% lines**)
    - `extensions/ci-github/providers/github-provider/index.ts` (**23.81% lines**)
    - `extensions/email-gmail/providers/gmail-provider/index.ts` (**22.75% lines**)
