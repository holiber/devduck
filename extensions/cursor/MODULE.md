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
    description: "Probes Cursor API to check the key works"
    var: "CURSOR_API_KEY"
    test: "sh -c 'test -n \"$CURSOR_API_KEY\" || exit 1; base=\"${CURSOR_API_BASE_URL:-https://api.cursor.sh}\"; code=\"$(curl -s -o /dev/null -w \"%{http_code}\" --connect-timeout 2 --max-time 5 \"$base/v1/models\" -H \"Authorization: Bearer $CURSOR_API_KEY\" 2>/dev/null || true)\"; case \"$code\" in 200|429) echo \"OK (HTTP $code)\"; exit 0 ;; 401|403) echo \"INVALID (HTTP $code)\"; exit 1 ;; 502|503|504|000) echo \"UNAVAILABLE (HTTP $code)\"; exit 0 ;; *) echo \"FAILED (HTTP $code)\"; exit 1 ;; esac'"
---
# Cursor Module

Module for integrating barducks with Cursor IDE. Handles:
- Copying commands from modules to `.cursor/commands/`
- Merging rules from modules to `.cursor/rules/barducks-rules.md`
- Generating `mcp.json` from module MCP configurations

This module is recommended for Cursor IDE integration, but is not required for all workspaces.

