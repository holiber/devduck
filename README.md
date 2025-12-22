# DevDuck

<div align="center">
  <img src="media/logo.png" alt="DevDuck Logo" width="200">
</div>

KrYa!

Devduck is rubber duck debugging — automated.
Explain the problem, and the duck will write code, close tickets, and ship changes.

## Quick Start

Install and setup everything:

```bash
node scripts/install.js
```

Or use `/install` command in Cursor IDE.

The installation script will:
- Set up environment variables
- Check and install required tools
- Configure MCP servers
- Verify everything works

## Key Features

This tool adds several commands to Cursor IDE that automate your daily developer tasks. It integrates with Yandex AI tools, Tracker, DeepAgent, Intrasearch, Arcadia, and more.

### `/install` — Setup Environment

Check and configure your development environment:

```bash
/install
# or
node scripts/install.js
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

### `/plan` — Implementation Planning

Plan and track implementation for Tracker issues:

```bash
/plan                    # List your open tasks
/plan CRM-47926          # Create or continue plan for issue
/plan done CRM-47926     # Archive completed plan
```

The AI will:
- Discover related tickets, Wiki pages, and attachments
- Generate structured implementation plan
- Answer questions using Intrasearch/DeepAgent
- Track progress through execution stages
- Validate plan before execution

**Example workflow:**
```
/plan CRM-47926
→ Loads task from Tracker
→ Discovers related resources (tickets, Wiki pages)
→ Generates implementation plan
→ Answers questions automatically
→ Tracks execution progress
→ Prepares testing plan
```

### `/task` — Task Runner

Run Tracker-backed tasks via warm Docker workers (max 3 in parallel), or create local tasks from free text:

```bash
/task run CRM-47926 --mode plan
/task run https://st.yandex-team.ru/CRM-47926 --mode plan

# Create a task from free text (not a ticket) — prepare plan + questions
/task run "Investigate why registry.yandex.net is unreachable from Docker and propose fixes" --mode plan

# Create a task from free text (not a ticket) — implementation mode
/task run "Investigate why registry.yandex.net is unreachable from Docker and propose fixes" --mode execute

/task list
/task logs <taskId>
```

### `/dashboard` — Terminal Dashboard (TUI)

Monitor tasks, queue, and Docker workers in an interactive terminal UI:

```bash
/dashboard
# or
node scripts/dashboard.js
```

### Prompt-driven planning (recommended)

If your goal is “work on tasks” (e.g. generate plans), use **prompts**. Prompts are queued and processed in the background once Docker workers are ready.

You can submit a prompt in two ways:

1) Launch dashboard and enqueue immediately:

```bash
node scripts/dashboard.js --prompt "Generate plans for CRM tasks without PRs (no PR pushed to Arcanum)"
```

2) Open dashboard and press `p`, then type your prompt and press Enter.

To inspect prompt processing from CLI:

```bash
node scripts/task.js prompt list
node scripts/task.js prompt bg status
```

### Docker-based parallel execution (advanced)

For faster processing of multiple tasks, you can run plan generation in isolated Docker containers:

```bash
# Multiple tasks (uses warm worker pool by default)
node scripts/task.js run CRM-47926,CRM-47927,CRM-47928

# Monitor status of parallel tasks
node scripts/plan-status.js
```

**Docker requirements:**
- Each container runs in isolation but shares `.cache/tasks/` volume
- Use `plan-status.js` to monitor progress of all running containers


### `/deepagent` — Ask DeepAgent

Ask questions directly to DeepAgent for information about Yandex services and internal tools:

```bash
/deepagent <your question>
```

DeepAgent can help with:
- Information about Yandex internal services
- Documentation and best practices
- Troubleshooting internal tools
- Architecture questions

**Example:**
```
/deepagent How do I configure SSL certificates for local development?
```


## Troubleshooting

If something goes wrong remove the `.cache` directory and re-run `node install.js`
Or type `/troubleshoot` command in AI chat
