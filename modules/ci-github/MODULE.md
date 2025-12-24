---
name: ci-github
version: 0.1.0
description: GitHub provider for the CI module
tags: [ci, github, providers]
dependencies: [ci]
checks:
  - type: "auth"
    var: "GITHUB_TOKEN"
    description: "Github API token"
    test: "curl -H 'Authorization: token $GITHUB_TOKEN' -H 'Accept: application/vnd.github.v3+json' -s -o /dev/null -w '%{http_code}' https://api.github.com/user"
---
# CI GitHub Module

This module provides a GitHub-backed provider for the `ci` module.

## Provider

- `github-provider` — reads CI information via the GitHub API (requires GITHUB_TOKEN).

## Requirements

- `GITHUB_TOKEN` environment variable set (GitHub personal access token or OAuth token)

## Usage

The provider is automatically discovered when the module is loaded. Configure it in `workspace.config.json`:

```json
{
  "moduleSettings": {
    "ci": {
      "provider": "github-provider"
    }
  }
}
```

Or set `CI_PROVIDER=github-provider` environment variable.

