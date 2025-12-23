---
name: cursor
version: 0.1.0
description: Cursor IDE integration (commands, rules, MCP configuration)
tags: [cursor, ide, integration]
dependencies: [core]
---
# Cursor Module

Module for integrating devduck with Cursor IDE. Handles:
- Copying commands from modules to `.cursor/commands/`
- Merging rules from modules to `.cursor/rules/devduck-rules.md`
- Generating `mcp.json` from module MCP configurations

This module is always included in workspace installations (like `core` module).

