---
name: core
version: 0.1.0
description: Core extension with baseline checks and shared defaults
tags: [core, essential]
checks:
  - name: "ripgrep"
    when: '[ "$(uname -s)" = "Darwin" ] && ! command -v rg >/dev/null 2>&1'
    test: "command -v rg >/dev/null 2>&1"
    install: "brew install ripgrep"
    requirement: "recomended"
    description: "A tool for search.  Faster and more powerful than grep. AI agents love this thing"
---
# Core Module

This module provides baseline checks and defaults that are useful for most workspaces.

