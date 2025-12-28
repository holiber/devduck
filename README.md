# DevDuck

<div align="center">
  <img src="media/logo.png" alt="DevDuck Logo" width="200">
</div>

KrYa!

Devduck is rubber duck debugging — automated.
Explain the problem, and the duck will write code, close tickets, and ship changes.

## Quick Start

### Create a new workspace (npx)

```bash
npx --yes github:holiber/devduck new ./my-devduck-workspace
```

This will:
- create `./my-devduck-workspace/workspace.config.yml`
- clone DevDuck into `./my-devduck-workspace/devduck/src` (unless DevDuck is already listed in `projects[]`)

### Create a new workspace from an existing `workspace.config.yml`

If you already have a `workspace.config.yml` (for example, checked into another repo or shared in your team), you can use it as a template:

```bash
npx --yes github:holiber/devduck new ./my-devduck-workspace --workspace-config /path/to/workspace.config.yml
```

DevDuck will merge your template on top of the defaults and write the result to `./my-devduck-workspace/workspace.config.yml`.

Your workspace can reference local projects too, for example:

```json
{
  "projects": [{ "src": "./my-app" }]
}
```

Then open the workspace in Cursor and run:

```bash
node install.js --workspace-path ./my-devduck-workspace
```

Or use `/install` command in Cursor IDE.

### Install and setup everything (inside an existing workspace)

```bash
node install.js
```

The installation script will:
- Set up environment variables
- Check and install required tools
- Configure MCP servers
- Verify everything works

### Taskfile-based installation (optional)

If you prefer a declarative Taskfile workflow (CursorCloud-friendly):

```bash
# Generate Taskfile runtime from workspace config
tsx ./devduck/src/scripts/devduck-cli.ts sync

# Run installation via go-task
npx --yes -p @go-task/cli task install
```

## CI Metrics and Artifacts

DevDuck includes a comprehensive CI metrics and artifacts collection system that automatically tracks performance and quality metrics for every Pull Request.

### Features

- **📊 Automatic Metrics Collection**: Build time, test time, bundle size, code changes
- **🎭 Playwright Integration**: Screenshots and videos for failed E2E tests
- **🤖 AI Agent Logging**: Track AI interactions during development
- **📈 Trend Visualization**: Compare metrics across PRs and detect regressions
- **💬 PR Comments**: Automatic summary comments on every PR

### Quick Start

The CI system runs automatically on every PR. To use it locally:

```bash
# Collect metrics
npm run ci:metrics

# Compare with baseline
npm run ci:compare .cache/metrics/metrics.json baseline.json

# Visualize trends
npm run ci:visualize

# Log AI agent actions
npm run ci:ai-log simple-log "cursor-ai" "Task completed"
```

### Documentation

For detailed information, see:
- [CI Metrics Documentation](docs/CI_METRICS.md) - Complete guide
- [CI Scripts README](scripts/ci/README.md) - Script usage and API

### Workflows

- **pr-metrics.yml**: Runs on every PR, collects metrics and artifacts
- **ci.yml**: Basic CI tests on push and PR

All artifacts (logs, screenshots, videos, AI logs) are automatically uploaded and available for 30 days.

## Commands

### `/install` — Setup Environment

Check and configure your development environment:

```bash
/install
# or
node install.js
```

Sets up environment variables, checks installed tools, configures MCP servers, and verifies everything works.

### `/commit` — Smart Commits

Get AI-generated commit messages based on your changes:

```bash
/commit
# or
node scripts/commit.js
```

The AI analyzes your changes and suggests an informative commit message with warnings about potential issues (sensitive files, debug code, config changes, etc.).

**Example workflow:**
```
/commit
→ AI analyzes changes
→ Suggests commit message
→ Shows warnings (if any)
→ Asks for approval
→ Commits and optionally pushes
```

### `/pr` — Pull Requests

Create or update PRs with auto-generated descriptions:

```bash
/pr
# or
node scripts/pr.js
```

The script handles the full PR workflow:
- Checks for uncommitted changes (suggests `/commit` first)
- Pushes unpushed commits
- Generates PR description from plan
- Creates PR or updates existing one

**Example workflow:**
```
/pr
→ Checks for uncommitted changes
→ If found, suggests /commit first
→ Generates PR plan file
→ Opens plan for review
→ After approval: pushes commits and creates/updates PR
```

## External Module Repositories

DevDuck supports loading modules from external repositories:

```bash
node install.js --repos git@github.com:user/repo.git,github.com/user/repo2
```

Supported URL formats:
- Git repositories: `git@github.com:user/repo.git`, `github.com/user/repo`
- Arcadia repositories: `arc://path/to/folder`

Modules from external repositories must include `manifest.json` (or `devduck.manifest.json`) with `devduckVersion` matching the main repository version.

## Troubleshooting

If something goes wrong remove the `.cache` directory and re-run `node install.js`
Or type `/troubleshoot` command in AI chat
