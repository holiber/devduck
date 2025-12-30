# Task: Task file naming convention

> File name: `docs/tasks/2025-12-30-0710-task-file-naming-convention.md` (kebab-case slug, 24h time)

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 Cursor Agent
- Branch: cursor/task-file-naming-convention-53f1
- PR: #110
- Related: N/A

## 1. Task

### What to do

- Update task file naming convention to include hours and minutes (YYYY-MM-DD-HHMM)
- Rename all existing task files to follow the new convention
- Update documentation and templates to reflect the new naming pattern
- Update CI workflow to enforce the new naming convention

### Definition of Done (acceptance criteria)

- All task files in `docs/tasks/` follow the `YYYY-MM-DD-HHMM-*.md` pattern
- Task template updated with new naming convention
- CI workflow validates new naming pattern
- Documentation updated to explain the new convention

### Out of scope

- Changing the content of existing task files
- Modifying other documentation conventions

## 2. Status Log

- 2025-12-30 07:10 — CI failure detected: missing task file for this PR
- 2025-12-30 07:10 — Creating task file to document this work

## 3. Plan

1. Rename all existing task files to include HHMM timestamp
2. Update task template with new naming convention
3. Update CI workflow to validate new pattern
4. Update related documentation
5. Create task file for this PR

## 4. Implementation Notes

- The new naming convention `YYYY-MM-DD-HHMM-*.md` ensures stable chronological sorting even when multiple tasks are created on the same day
- Uses 24-hour time format for consistency
- All existing files were renamed to preserve git history (using `git mv`)
- CI regex pattern updated to: `^docs/tasks/[0-9]{4}-[0-9]{2}-[0-9]{2}-([01][0-9]|2[0-3])[0-5][0-9]-.*\.md$`

## 5. CI Attempts

### Attempt 1/1

- What failed: Missing new task file matching the updated pattern
- What I changed: Created this task file documenting the naming convention update
- Links: https://github.com/holiber/barducks/actions/runs/20591106009

## 6. Final Report

### What changed

- Renamed 25 existing task files to include HHMM timestamp
- Updated `.github/workflows/follow-guidelines.yml` to enforce new naming pattern
- Updated `docs/for-llm-devs/_task-template.md` with new naming convention
- Updated `docs/for-llm-devs/agent-workflow.md` and `docs/for-llm-devs/llm-dev-workflow-plan.md`
- Updated `CHANGELOG.md` and `CONTRIBUTING.md`
- Updated `src/ci/enforce-agent-pr-workflow.mjs` to validate new pattern

### How to verify

- Run: `ls docs/tasks/` and verify all files match `YYYY-MM-DD-HHMM-*.md` pattern
- Check CI passes with the new task file present
- Verify files sort chronologically: `ls -1 docs/tasks/ | sort`

### Risks / Follow-ups

- Agents and developers need to be aware of the new naming convention
- Consider adding a pre-commit hook to validate task file naming
