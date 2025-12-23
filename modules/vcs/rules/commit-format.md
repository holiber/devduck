---
alwaysApply: false
globs: ["**/*.js", "**/*.ts", "**/*.py", "**/*.md", "**/scripts/**"]
---
# Commit Message Formatting Rules

## General Principles

- Prefer **imperative** mood and be specific: **what changed** + (optionally) **why**.
- Avoid generic messages like: `Update files`, `Fix`, `WIP`, `Changes`, `Update N files`.
- If changes are limited to a small scope, mention it (e.g. `pr/`, `commit/`, `docs/`).
- If there are multiple unrelated changes, suggest **splitting** into separate commits instead of writing a vague message.
- Keep it short: typically 50–72 chars for the subject line.

## Examples

Good commit messages:
- `docs(commit): clarify informative commit message rules`
- `pr: require explicit approval before write actions`
- `scripts(commit): derive message from changed command docs`
- `refactor(vcs): extract commit formatting rules to vcs module`
- `fix(plan): handle missing tracker token gracefully`

Bad commit messages:
- `Update files`
- `Fix`
- `WIP`
- `Changes`
- `Update 5 files`
- `Various improvements`

## Format

When writing commit messages:
1. Use imperative mood (e.g., "Add feature" not "Added feature")
2. Be specific about what changed
3. Optionally include why (if not obvious)
4. Use scope prefix if applicable (e.g., `module(scope): message`)
5. Keep subject line under 72 characters

## AI Agent Responsibilities

When creating commits:
1. Review the changes
2. Generate informative commit message following these rules
3. Override script suggestions if they don't follow these rules
4. Suggest splitting commits if changes are unrelated
5. Ensure commit message clearly describes what changed

