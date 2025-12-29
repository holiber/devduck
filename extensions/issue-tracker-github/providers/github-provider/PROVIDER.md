---
name: github-provider
type: issue-tracker
version: 0.1.0
description: GitHub provider for issue tracker module
---

# GitHub Provider

GitHub provider for the issue tracker module. Provides integration with GitHub Issues API.

## Purpose

This provider enables:
- Fetching GitHub issues by ID or URL
- Retrieving issue comments
- Finding related pull requests
- Downloading issue resources (images, files, etc.)

## Authentication

Requires `GITHUB_TOKEN` environment variable with a GitHub personal access token.

## Features

- Parses GitHub issue URLs (e.g., `https://github.com/owner/repo/issues/20`)
- Extracts owner/repo from git remote or URL
- Downloads linked resources from issue body and comments
- Tracks distance-based resource relationships

