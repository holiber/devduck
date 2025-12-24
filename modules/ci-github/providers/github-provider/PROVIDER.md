# GitHub CI Provider

GitHub provider for the CI module.

## Purpose

This provider implements the CI contract using the GitHub API to fetch PR information, check status, and comments.

## Capabilities

- `fetchPR` - Fetches PR information from GitHub API
- `fetchCheckStatus` - Fetches check runs and annotations from GitHub API
- `fetchComments` - Fetches PR comments and reactions from GitHub API

## Requirements

- `GITHUB_TOKEN` environment variable (GitHub personal access token or OAuth token)
- Repository owner and repo name must be provided in input

## API Endpoints Used

- `GET /repos/{owner}/{repo}/pulls/{pull_number}` - Get PR information
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` - Get PR reviews
- `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` - Get check runs for a commit
- `GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations` - Get check run annotations
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/comments` - Get PR comments

## Usage

The provider requires `owner` and `repo` parameters in the input for all methods. It can work with:
- PR ID (number)
- Branch name (will find the open PR for that branch)
- Commit SHA (for check status)

