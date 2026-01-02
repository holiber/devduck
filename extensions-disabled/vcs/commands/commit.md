# Commit

Analyze changes and suggest commit message. The script outputs structured information for AI agent to review.

The script will:
- Check current branch (warns if on trunk)
- List all changed files with their status
- Generate suggested commit message based on file changes
- Analyze changes for potential issues and warnings
- Output structured JSON for AI agent review

Usage: `node scripts/commit.js [-y|--yes]`

## Options

- `-y`, `--yes` — Auto-commit without asking for confirmation (only if no warnings detected)

## Safety rules (must follow)

- **Model requirement**: any operation that can create or modify commits/PRs (commit, push, PR create, PR description update) must be performed using the **most powerful available model**. **Currently: GPT-5.2**.
- **No write operations without explicit approval**:
  - When the user runs `/commit` **without** `-y`, the agent must do **analysis only** and then **ask to continue** before running any write commands.
  - The agent may run write commands **only** if:
    - The user ran `/commit -y` (or `node scripts/commit.js -y`) **and** the analysis output indicates `autoCommit: true`, **or**
    - The user explicitly approved the action in chat (e.g. “yes, commit”, “go ahead and commit these changes”).
- **Write commands include** (non-exhaustive): `arc add`, `arc commit`, `arc push`, `arc pr create`, `node scripts/pr.js --update-description`.

The script outputs JSON with:
- Current branch information
- List of changed files (added, modified, deleted, renamed)
- Suggested commit message
- Warnings about potential issues (sensitive files, debug code, etc.)
- Info messages (missing tests, large diffs, etc.)
- Summary statistics
- `autoCommit` flag (true if `-y` flag passed and no warnings)

**Important**: AI agent should:
1. Review the output
2. If `autoCommit: true` — execute commit without asking
3. If `autoCommit: false` — check warnings and ask user for confirmation
4. Update current README.md if needed
5. Create item in `docs/ROADMAP-DRAFT.md` if some useful feature implemented
6. Ensure the commit message is informative (override the script suggestion if needed):
   - Prefer **imperative** mood and be specific: **what changed** + (optionally) **why**.
   - Avoid generic messages like: `Update files`, `Fix`, `WIP`, `Changes`, `Update N files`.
   - If changes are limited to a small scope, mention it (e.g. `pr/`, `commit/`, `docs/`).
   - If there are multiple unrelated changes, suggest **splitting** into separate commits instead of writing a vague message.
   - Keep it short: typically 50–72 chars for the subject line.
   - Examples:
     - `docs(commit): clarify informative commit message rules`
     - `pr: require explicit approval before write actions`
     - `scripts(commit): derive message from changed command docs`
7. Execute commit commands if approved: `arc add --all && arc commit -m "message"`
8. Ask if user wants to push changes
