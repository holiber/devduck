---
name: smogcheck-provider
type: issue-tracker
version: 0.1.0
description: Test provider for issue tracker module
---

# Smogcheck Provider

Test provider for the issue tracker module. Provides mock data for testing the contract implementation.

## Purpose

This provider is used for:
- Testing the issue tracker contract
- Validating resource management utilities
- Providing reference implementation for other providers

## Mock Data

The provider includes mock data for:
- Issues with descriptions and metadata
- Comments with reactions
- Related PRs
- Resource URLs (wiki pages, related tickets, attachments)

## Resource Downloading

The provider simulates resource downloading:
- Downloads resources with distance <= 2
- Tracks resources with distance == 3 without downloading
- Creates proper directory structure in `.cache/issues/`
- Generates `resources.json` with metadata

## Usage

This provider is automatically used when no other providers are configured or when explicitly selected:

```bash
issue-tracker fetchIssue issue-1 --provider smogcheck-provider
```

