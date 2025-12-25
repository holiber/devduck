---
name: issue-tracker
version: 0.1.0
description: Issue tracker module with provider system for working with issues, comments, PRs, and resources
tags: [issues, tracker, providers]
dependencies: [core]
defaultSettings:
  provider: smogcheck-provider
---
# Issue Tracker Module

Issue tracker module implementing a provider system based on a Zod contract for working with issues, comments, pull requests, and downloading resources.

## Purpose

This module provides:
- Provider-based architecture for issue tracker operations
- Common interface for fetching issue information, comments, PRs, and downloading resources
- Support for different issue tracking systems (GitHub Issues, Yandex Tracker, etc.) via providers
- Resource management with distance-based downloading and caching

## Architecture

The module defines a Zod contract that issue tracker providers must implement:
- `fetchIssue` - Get issue information by ID or URL with description
- `fetchComments` - Get issue comments
- `fetchPRs` - Get related pull requests or branches
- `downloadResources` - Download issue resources to `.cache/issues/` folder

## Providers

- `smogcheck-provider` - Test provider (included in this module)
- `github-provider` - GitHub Issues provider (in `issue-tracker-github` module)
- Additional providers can be provided by external modules

## Provider selection

- `workspace.config.json`: `moduleSettings.issueTracker.provider`
- Environment variable: `ISSUE_TRACKER_PROVIDER`
- Fallback: first available provider (after discovery)

## Commands

- `issue-tracker fetchIssue <issueId|url>` - Fetch issue information
- `issue-tracker fetchComments <issueId>` - Fetch issue comments
- `issue-tracker fetchPRs <issueId>` - Fetch related PRs or branches
- `issue-tracker downloadResources <issueId> [--maxDistance <number>]` - Download issue resources

All commands support `--provider <name>` to override the configured provider and output JSON.

## Resource Management

When downloading resources, the module:
- Creates `.cache/issues/{issue-id}/` directory structure
- Downloads resources with distance <= 2 by default (configurable via `--maxDistance`)
- Tracks resources with distance == 3 in `resources.json` without downloading
- Creates `resources.json` with metadata about all discovered resources
- Saves downloaded files to `resources/` subdirectory
- Creates `resources/issue.json` with issue data and comments
- Links related PRs in `.cache/prs/` directories

## Resource Structure

```
.cache/issues/{issue-id}/
├── resources.json          # Metadata about all resources
└── resources/
    ├── issue.json         # Main issue data with comments
    └── ...                # Other downloaded resources
```

