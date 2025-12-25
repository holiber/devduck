---
name: mcp
version: 0.1.0
description: MCP module for listing MCP servers and their tools
tags: [mcp, servers, tools]
dependencies: [core]
---
# MCP Module

MCP module for accessing MCP server information and tools.

## Purpose

This module provides:
- List all available MCP servers configured in workspace
- List tools available from a specific MCP server

## API

- `list` - List MCP servers (no parameters) or list tools for a specific server (with serverName parameter)

