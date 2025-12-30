# Test Coverage Gaps Analysis (2025-12-30)

## Summary

Unit test coverage analysis using c8 on the test suite.

- **Total coverage**: 63.54% lines, 61.33% branches, 65.11% functions
- **Analysis date**: 2025-12-30
- **Related PR**: Code coverage analysis
- **Related task doc**: docs/tasks/2025-12-30-test-coverage-gap-analysis.md

## Highest-Risk Low-Coverage Modules

Prioritized modules that need follow-up tests:

### 1. `src/lib/repo-modules.ts` (23.18% lines, 25% branches)

**Risk areas:**
- Repo URL parsing (`git@`, `https://`, `github.com/...`, `arc://`)
- Symlink behavior
- Clone/pull flows
- Version gating via `barducks.manifest.json`

### 2. `src/lib/api/mcp.ts` (26.94% lines)

**Risk areas:**
- Spawning MCP servers
- stdio JSON-RPC framing
- Timeouts
- Error propagation
- Process cleanup

### 3. `src/install/mcp.ts` (45.33% lines, 28.57% branches)

**Risk areas:**
- Generating `.cursor/mcp.json` from checks + `.env`
- Optional vs required servers
- URL checks/timeout semantics
- Command discovery (`command -v`, `which`, `~` expansion)

### 4. `src/barducks-cli.ts` (26.92% lines, 40% branches)

**Risk areas:**
- `new` workspace flow
- Filesystem writes
- `INIT_CWD` path resolution
- Robust handling of `git`/`npm install` failures

### 5. Integration-heavy providers (very low unit coverage)

These likely need fixture-based tests rather than live credentials:

- `extensions/issue-tracker-github/providers/github-provider/index.ts` (19.15% lines)
- `extensions/ci-github/providers/github-provider/index.ts` (23.81% lines)
- `extensions/email-gmail/providers/gmail-provider/index.ts` (22.75% lines)

## Recommendations

1. **Priority 1**: Add unit tests for `repo-modules.ts` URL parsing and clone flows
2. **Priority 2**: Add tests for MCP server spawning and cleanup in `mcp.ts`
3. **Priority 3**: Add fixture-based integration tests for GitHub and Gmail providers
4. **Priority 4**: Improve CLI test coverage for workspace initialization flows
