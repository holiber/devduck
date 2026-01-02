# Email Module

Email module implementing a provider system based on a Zod contract (future AsyncAPI/MCP generation).

## Command

- `/email` — list unread emails for the last week (by default) using the active provider.

## Provider selection

- `workspace.config.yml`: `moduleSettings.email.provider`
- Environment variable: `EMAIL_PROVIDER`
- Fallback: first available provider (after discovery)

