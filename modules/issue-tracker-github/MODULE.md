---
name: issue-tracker-github
version: 0.1.0
description: GitHub provider for the issue tracker module
tags: [issue-tracker, github, providers]
dependencies: [issue-tracker]
checks:
  - type: "auth"
    var: "GITHUB_TOKEN"
    description: "GitHub API token"
    test: "curl -H 'Authorization: token $GITHUB_TOKEN' -H 'Accept: application/vnd.github.v3+json' -s -o /dev/null -w '%{http_code}' https://api.github.com/user"
---
# Issue Tracker GitHub Module

This module provides a GitHub-backed provider for the `issue-tracker` module.

## Provider

- `github-provider` — reads issue information via the GitHub API (requires GITHUB_TOKEN).

## Requirements

- `GITHUB_TOKEN` environment variable set (GitHub personal access token or OAuth token)

## Usage

The provider is automatically discovered when the module is loaded. Configure it in `workspace.config.json`:

```json
{
  "moduleSettings": {
    "issueTracker": {
      "provider": "github-provider"
    }
  }
}
```

Or set `ISSUE_TRACKER_PROVIDER=github-provider` environment variable.

