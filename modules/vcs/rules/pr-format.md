---
alwaysApply: false
globs: ["**/pr*.md", "**/.cache/tasks/pr/**", "**/templates/pr.plan.md"]
---
# Pull Request Description Formatting Rules

## PR Plan Structure

The PR plan file (`.cache/tasks/pr/<pr-name>.plan.md`) is the single source of truth for PR description.

### Required Structure

The plan MUST strictly follow the template structure (treat `templates/pr.plan.md` as a contract).

### Required Sections

1. **Title** - First line (`# ...`) becomes PR title
2. **PR Description** section - becomes PR description body:
   - Short intro paragraph
   - Icon-only bullet list (Feature/Bugfix/Refactor/Cleanup/Tests/Docs)

### Optional Sections

The plan may include up to 3 additional sections only:
- `AI Suggestions — Documentation`
- `AI Suggestions — Unreachable Code Cleanup`
- `AI Suggestions — Recipes`

The plan may include `## Additional Notes` only if the AI has warnings/notes.

### Forbidden Sections

The plan MUST NOT include extra technical sections:
- `## Changed Files`
- `## Affected Areas`
- Commit lists
- Other technical details (these belong in code review, not PR description)

## PR Description Content

### Intro Paragraph

- Brief, clear description of what the PR does
- Focus on the "what" and "why", not the "how"
- Keep it concise (2-3 sentences)

### Icon List

Use icon-only bullet list to indicate PR type:
- Feature - new functionality
- Bugfix - bug fixes
- Refactor - code refactoring without behavior changes
- Cleanup - code cleanup, removal of dead code
- Tests - test additions or improvements
- Docs - documentation updates

## Workflow

1. Generate plan file at `.cache/tasks/pr/<pr-name>.plan.md`
2. Open plan file in IDE
3. Ask user to check relevant checkboxes
4. Wait for explicit approval (`ok` / `approve` / `продолжай`)
5. Use plan file to create/update PR description

## AI Agent Responsibilities

When creating/updating PRs:
1. Generate plan file following template structure
2. Include only required and allowed sections
3. Exclude technical details from PR description
4. Wait for user approval before creating/updating PR
5. Use plan file as single source of truth for PR description
6. After PR creation/update, archive plan file to `.cache/trash/`
7. Always show PR URL in output

