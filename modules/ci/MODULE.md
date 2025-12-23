---
name: ci
version: 0.1.0
description: Abstract CI interface for continuous integration systems
tags: [ci, testing, integration]
dependencies: [core, vcs]
---
# CI Module

Module providing abstract interface for continuous integration (CI) systems.

## Purpose

This module provides:
- Abstract base class for CI operations
- Common interface for CI setup and status checking
- Support for different CI systems (GitHub Actions, Arcadia CI, etc.)

## Architecture

The module defines an abstract `CI` class that must be implemented by specific CI providers:
- `github-ci` - GitHub Actions implementation
- `ya-arc-ci` - Arcadia CI implementation (in external repository)

## Usage

```javascript
const CI = require('./modules/ci/scripts/ci');
const Repo = require('./modules/vcs/scripts/repo');

// CI implementations are provided by specific modules
// Example: const GitHubCI = require('./modules/github-ci/scripts/github-ci');
```

## Note

CI-specific implementations are provided by other modules (e.g., `github-ci` for GitHub Actions, `ya-arc-ci` for Arcadia CI).

