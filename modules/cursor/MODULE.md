---
name: cursor
version: 0.1.0
description: Cursor IDE integration (commands, rules, MCP configuration)
tags: [cursor, ide, integration]
dependencies: [core]
checks:
  - type: "auth"
    var: "CURSOR_API_KEY"
    description: "Checks that CURSOR_API_KEY is set and valid (cheap GET /v1/models probe)"
    docs: "Get a key at https://cursor.com/dashboard?tab=integrations"
    optional: true
    test: "sh -c 'test -n \"$CURSOR_API_KEY\" || exit 0; curl -s -o /dev/null -w \"%{http_code}\" https://api.cursor.sh/v1/models -H \"Authorization: Bearer $CURSOR_API_KEY\"'"
---
# Cursor Module

Module for integrating devduck with Cursor IDE. Handles:
- Copying commands from modules to `.cursor/commands/`
- Merging rules from modules to `.cursor/rules/devduck-rules.md`
- Generating `mcp.json` from module MCP configurations

This module is always included in workspace installations (like `core` module).

