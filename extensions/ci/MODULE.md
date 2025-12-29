---
name: ci
version: 0.2.0
description: CI module with provider system for continuous integration systems
tags: [ci, testing, integration, providers]
dependencies: [core]
defaultSettings:
  provider: smogcheck-provider
---
# CI Module

CI module implementing a provider system based on a Zod contract for working with pull requests, merge checks, and comments.

## Purpose

This module provides:
- Provider-based architecture for CI operations
- Common interface for fetching PR information, check status, and comments
- Support for different CI systems (GitHub Actions, Arcanum, etc.) via providers

## Architecture

The module defines a Zod contract that CI providers must implement:
- `fetchPR` - Get PR information (status, comment count, merge check status, reviewers)
- `fetchCheckStatus` - Get merge check status with annotations (for debugging failed tests)
- `fetchComments` - Get comments and reactions for PR

## Providers

- `smogcheck-provider` - Test provider (included in this module)
- `github-provider` - GitHub provider (in `ci-github` module)
- Additional providers can be provided by external modules

## Provider selection

- `workspace.config.yml`: `moduleSettings.ci.provider`
- Environment variable: `CI_PROVIDER`
- Fallback: first available provider (after discovery)

## Commands

- `ci pr <prId|branch>` - Fetch PR information
- `ci checks <prId|branch> [--checkId <id>]` - Fetch check status with annotations
- `ci comments <prId|branch>` - Fetch PR comments and reactions

All commands support `--provider <name>` to override the configured provider and `--json` for JSON output.



