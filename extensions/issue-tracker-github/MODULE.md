# Issue Tracker GitHub Module

This module provides a GitHub-backed provider for the `issue-tracker` module.

## Provider

- `github-provider` — reads issue information via the GitHub API (requires GITHUB_TOKEN).

## Requirements

- `GITHUB_TOKEN` environment variable set (GitHub personal access token or OAuth token)

## Usage

The provider is automatically discovered when the module is loaded. Configure it in `workspace.config.yml`:

```yaml
moduleSettings:
  issueTracker:
    provider: github-provider
```

Or set `ISSUE_TRACKER_PROVIDER=github-provider` environment variable.

