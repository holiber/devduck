---
name: email
version: 0.1.0
description: Email module with provider system (AsyncAPI/MCP-ready contract)
tags: [email, providers]
dependencies: [core]
defaultSettings:
  provider: smogcheck-provider
---
# Email Module

Email module implementing a provider system based on a Zod contract (future AsyncAPI/MCP generation).

## Command

- `/email` — list unread emails for the last week (by default) using the active provider.

## Provider selection

- `workspace.config.json`: `moduleSettings.email.provider`
- Environment variable: `EMAIL_PROVIDER`
- Fallback: first available provider (after discovery)

