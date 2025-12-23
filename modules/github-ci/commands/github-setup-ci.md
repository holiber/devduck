# GitHub Setup CI

Setup GitHub Actions CI workflows for GitHub repositories in the workspace.

## Description

This command sets up GitHub Actions CI workflows for all GitHub repositories found in the workspace configuration. The AI agent should perform the setup directly without using a script.

## Workflow

The AI agent should:

### 1. Find GitHub repositories

- Load `workspace.config.json` from workspace root
- Find all projects in `projects` array
- Filter projects where `src` contains `github.com`
- For each GitHub repository:
  - Parse repository URL to extract owner and repo name
  - Determine project path: `projects/{projectName}` where projectName is extracted from repo URL

### 2. For each GitHub repository

#### 2.1. Verify repository exists
- Check if project directory exists
- Check if it's a git repository (has `.git` directory)
- Skip if not found or not a git repo

#### 2.2. Check if workflow already exists
- Check if `.github/workflows/ci.yml` exists
- If exists, skip this repository (don't overwrite)

#### 2.3. Determine test command
- Read `package.json` from repository root
- Extract `scripts.test` field
- If not found, default to `npm test`

#### 2.4. Determine base branch
- Check if `main` branch exists: `git rev-parse --verify main 2>/dev/null`
- If not, check if `master` branch exists: `git rev-parse --verify master 2>/dev/null`
- Use the found branch, or default to `main`

#### 2.5. Create workflow file
- Load template from `modules/github-ci/templates/ci-workflow.yml`
- Replace `{{TEST_COMMAND}}` with the detected test command
- Replace `branches: [ main, master ]` with `branches: [ ${baseBranch} ]` (single branch)
- Create `.github/workflows/` directory if it doesn't exist
- Write `ci.yml` file with the processed template

### 3. Report results

- List all repositories processed
- For each repository, report:
  - Status: `created`, `skipped` (workflow exists), `error`, or `not_found`
  - Test command used
  - Base branch used
  - Workflow path (if created)
  - Error message (if error occurred)

## Template location

The workflow template is located at:
- `projects/devduck/modules/github-ci/templates/ci-workflow.yml`

## Template placeholders

- `{{TEST_COMMAND}}` - Should be replaced with the test command from package.json
- `branches: [ main, master ]` - Should be replaced with `branches: [ ${baseBranch} ]` where baseBranch is the detected branch

## Example workflow output

After processing, the workflow file should look like:

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [20.x]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
```

## Notes

- Workflows are only created if they don't already exist
- The workflow uses Node.js 20.x (latest stable)
- Test command is auto-detected from `package.json` scripts.test
- If no test script is found, defaults to `npm test`
- The script works with repositories in `workspace.config.json` projects array

