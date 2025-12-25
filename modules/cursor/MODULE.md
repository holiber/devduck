---
name: cursor
version: 0.1.0
description: Cursor IDE integration (commands, rules, MCP configuration)
tags: [cursor, ide, integration]
dependencies: [core]
checks:
  - type: "auth"
    var: "CURSOR_API_KEY"
    description: "Checks that CURSOR_API_KEY is set"
    docs: "Get a key at https://cursor.com/dashboard?tab=integrations"
    test: "sh -c 'test -n \"$CURSOR_API_KEY\"'"
  - type: "test"
    name: "cursor-api-key-valid"
    description: "Optional: probes Cursor API to check the key works (best-effort)"
    optional: true
    var: "CURSOR_API_KEY"
    test: "sh -c 'test -n \"$CURSOR_API_KEY\" || exit 1; code=\"$(curl -s -o /dev/null -w \"%{http_code}\" https://api.cursor.sh/v1/models -H \"Authorization: Bearer $CURSOR_API_KEY\")\"; test \"$code\" = \"200\" -o \"$code\" = \"429\"'"
---
# Cursor Module

Module for integrating devduck with Cursor IDE. Handles:
- Copying commands from modules to `.cursor/commands/`
- Merging rules from modules to `.cursor/rules/devduck-rules.md`
- Generating `mcp.json` from module MCP configurations

This module is always included in workspace installations (like `core` module).

