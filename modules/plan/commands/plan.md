# Plan

Create or continue working on an implementation plan for a Tracker issue. The script outputs structured information for AI agent to review and execute actions.

Usage: `node scripts/plan.js [issueKey|url]` or `node scripts/plan.js done <issueKey>`

## Commands

- `node scripts/plan.js` — List open tasks assigned to current user
- `node scripts/plan.js <issueKey|url>` — Create or continue plan for specified issue
- `node scripts/plan.js <issueKey1>,<issueKey2>,...` — Create plans for multiple issues (batch mode)
- `node scripts/plan.js done <issueKey>` — Archive plan and mark task as done
- `node scripts/docker.js <issueKey1>[,<issueKey2>,...]` — Run plan generation in parallel Docker containers
- `node scripts/plan-status.js [--format json|table]` — Monitor status of parallel plan generation

## Options

- `--parallel` — Run plan generation in isolated Docker containers (use `docker.js` script)
- `--status` — Check status of parallel tasks (use `plan-status.js` script)

## Safety rules (must follow)

- **No automatic execution**: The script does NOT execute any actions automatically
- **AI agent review required**: AI agent should review the output and guide the user through the process
- **User confirmation**: Before starting execution of the plan, AI must ask for explicit user approval

## Workflow

The AI agent should follow this workflow:

### 1. List tasks (no arguments)

When user runs `/plan` without arguments:
- Execute `node scripts/plan.js`
- Display formatted list of open assigned tasks
- Let user select a task to work on

### 2. Create or continue plan

When user runs `/plan <issueKey>` or `/plan <url>`:
- Execute `node scripts/plan.js <issueKey>`
- The script will:
  1. Check if plan directory exists (`.cache/tasks/{issueKey}_*/`)
  2. If exists — ask user: continue existing or create new
  3. If not exists — create new plan directory
  4. Load task data from Tracker API
  5. Discover resources (links, related tickets, Wiki pages, attachments)
  6. Load resources (distance <= 2 by default)
  7. Generate implementation plan
  8. Identify questions and try to answer them using intrasearch/deepagent
  9. Output structured JSON with plan status and next steps

### 2.1. Multiple issues (batch mode)

When user runs `/plan <issueKey1>,<issueKey2>,...`:
- Execute `node scripts/plan.js <issueKey1>,<issueKey2>,...`
- The script processes all issues sequentially
- Outputs JSON array with results for each issue
- Each issue is processed independently

### 2.2. Parallel execution with Docker

When user runs `/plan <issueKey1>,<issueKey2>,... --parallel`:
- Execute `node scripts/docker.js <issueKey1>,<issueKey2>,...`
- Each issue runs in an isolated Docker container
- Containers execute in parallel for faster processing
- Results are saved to `.cache/tasks/` as usual
- Monitor progress with `node scripts/plan-status.js`

**Requirements:**
- Docker and Docker Compose must be installed
- Docker image will be built automatically on first run
- Each container has isolated workspace but shares `.cache/tasks/` volume

## Cursor Agent (recommended for execution)

When implementing tasks (especially inside Docker workers), prefer `cursor-agent` in unattended mode:

```bash
cursor-agent -p --force "your instruction here" --model "gpt-5.2"
```

For quick/cheap steps (formatting, small refactors, translations), use a cheaper model:
```bash
cursor-agent -p --force "translate title to English" --model "composer-1"
```

The API key (`CURSOR_API_KEY`) is automatically passed from host `.env` to Docker containers.

### 3. Plan structure

Each plan is stored in `.cache/tasks/{issueKey}_{sanitized_title}/`:
- `plan.md` — Main plan file with stages, resources, implementation steps, questions, execution log, testing plan (single source of truth)
- `resources.json` — Metadata about all discovered resources
- `resources/` — Directory with all downloaded resources (flat structure, no subdirectories):
  - `task.json` — Main task data from Tracker API
  - `{TICKET-KEY}.json` — Related tickets (e.g., `CRM-47090.json`)
  - `{wiki-page-name}.md` — Wiki pages (markdown files)
  - Other resource files (attachments, etc.)
- `temp/` — Directory for temporary files created during implementation (scripts, test files, drafts, etc.). This directory is not tracked and can be cleaned up after task completion.

### 4. Plan stages

The plan tracks progress through these stages:
- `initialized` — Plan directory created
- `task_loaded` — Task data loaded from API
- `resources_discovered` — All resources discovered
- `resources_loading` — Resources being downloaded
- `resources_loaded` — All required resources downloaded
- `plan_generation` — Generating implementation plan
- `questions_identified` — Questions found that need answers
- `questions_answered` — Questions answered (via MCP or user)
- `plan_ready` — Plan is ready for execution
- `execution_started` — Work on task has started
- `execution_in_progress` — Work in progress
- `execution_completed` — Implementation completed
- `testing_prepared` — Testing plan prepared
- `done` — Task completed and archived

### 5. Resource discovery and loading

Resources are discovered from:
- Task description and comments (parsed for URLs)
- Tracker API `/v3/issues/{id}/links` endpoint
- Related tickets (recursively, up to distance 2 by default)

Resource types:
- **Tickets** (`st.yandex-team.ru/{KEY}`) — Loaded as JSON via Tracker API
- **Wiki pages** (`wiki.yandex-team.ru/...`) — Loaded via MCP (preferred) or API fallback, saved as markdown
- **Arcadia files** (`a.yandex-team.ru/arcadia/...`) — Only link stored, not downloaded
- **Attachments** — Downloaded via Tracker API

Resources with `distance > 2` are only listed in `resources.json` without downloading.

### 6. Plan generation

After resources are loaded:
- AI analyzes all resources (task, related tickets, Wiki pages)
- Generates structured implementation plan in `plan.md`
- Identifies unclear points and creates "Questions for clarification" section
- Tries to answer questions using:
  1. intrasearch MCP (preferred)
  2. deepagent MCP (fallback)
- Updates plan with answers
- If questions remain — prepares list for user

### 7. Plan validation

Before starting execution, validate:
- All required resources are loaded
- Plan contains concrete steps
- No critical unanswered questions
- Files/modules to modify are specified

### 8. Execution tracking

During execution:
- AI manually updates "Execution progress" section in `plan.md`
- Automatically track:
  - File changes (via `arc status`)
  - Commits (via `arc log`)
  - Task updates in Tracker (periodic checks)

### 9. Testing plan

After implementation:
- Generate testing plan section in `plan.md`
- Include test cases, manual testing steps, automated tests if applicable

### 10. Archive plan

When user runs `/plan done <issueKey>`:
- Move plan directory to `.cache/trash/{issueKey}_{title}.{timestamp}/`
- Update plan status to `done`

## Important Notes

- The script uses `scripts/tracker.js` for all Tracker API requests
- Resources are loaded with retry logic (exponential backoff: 1s, 2s, 4s)
- Critical errors (no access to task) stop the process
- Non-critical errors (Wiki load failed) are logged with warnings but don't stop the process
- All errors are logged in the plan file

## AI Agent Responsibilities

1. **Review script output**: Always review JSON output from the script
2. **Guide user**: Help user understand current status and next steps
3. **Generate plan content**: When script indicates `plan_generation` stage, AI should generate detailed implementation plan in `plan.md` (do NOT create separate `implementation-plan.md` or `execution-log.txt` files)
4. **Answer questions**: Use MCP tools (intrasearch/deepagent) to answer questions from plan
5. **Update progress**: Regularly update "Execution progress" section in `plan.md` during work (do NOT create separate execution log files)
6. **Validate before execution**: Ensure plan is complete and validated before starting
7. **Track changes**: Monitor file changes and commits during execution
8. **Temporary files**: If temporary files are needed during implementation (test scripts, drafts, etc.), place them in `temp/` directory within the plan folder
9. **Generate testing plan**: Create comprehensive testing plan section in `plan.md` after implementation
10. **Archive when done**: Move plan to trash when user confirms completion

## Example Usage

```bash
# List open tasks
node scripts/plan.js

# Create plan for single task
node scripts/plan.js CRM-47926

# Create plans for multiple tasks (sequential)
node scripts/plan.js CRM-47926,CRM-47927,CRM-47928

# Create plans in parallel Docker containers
node scripts/docker.js CRM-47926,CRM-47927,CRM-47928

# Monitor status of parallel tasks
node scripts/plan-status.js

# Monitor status in JSON format
node scripts/plan-status.js --format json

# Continue existing plan
node scripts/plan.js CRM-47926

# Archive completed plan
node scripts/plan.js done CRM-47926
```
