# CI GitHub Module

This module provides a GitHub-backed provider for the `ci` module.

## Provider

- `github-provider` — reads CI information via the GitHub API (requires GITHUB_TOKEN).

## Requirements

- `GITHUB_TOKEN` environment variable set (GitHub personal access token or OAuth token)

## Usage

The provider is automatically discovered when the module is loaded. Configure it in `workspace.config.yml`:

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

