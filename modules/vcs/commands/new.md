# New

Reset all repositories to their base branches and pull latest changes. The script checks for uncommitted changes and untracked files before performing operations.

Usage: `node projects/devduck/modules/vcs/scripts/new.js`

## Purpose

The `/new` command helps you start fresh by:
- Checking all git repositories in `projects/` for uncommitted changes and untracked files
- Checking arc working copy for uncommitted changes and untracked files
- If everything is clean, switching all repositories to their base branches and pulling latest changes
- If there are changes, reporting detailed information about what needs to be committed or cleaned up

## Workflow

1. **Check git repositories**:
   - For each git project in `workspace.config.json`:
     - Check for uncommitted changes (`git status --porcelain`)
     - Check for untracked files
     - If clean, determine base branch (main/master) and prepare for checkout/pull

2. **Check arc working copy**:
   - Check for uncommitted changes (`arc status`)
   - Check for untracked files
   - If clean, prepare for checkout to trunk and pull

3. **Execute operations** (only if all checks pass):
   - For each git repository: `git checkout <baseBranch>` then `git pull`
   - For arc: `arc checkout trunk` then `arc pull`

4. **Report errors** (if any checks fail):
   - List all repositories with uncommitted changes
   - List all untracked files
   - Provide detailed information about what needs to be handled

## Safety rules

- **No automatic execution**: The script checks status first and only proceeds if everything is clean
- **Detailed error reporting**: If there are any uncommitted changes or untracked files, the script will report exactly where they are
- **Base branch detection**: Automatically detects the correct base branch for each git repository (main or master)

## Output

The script outputs JSON with:
- `ok`: boolean - whether all operations completed successfully
- `gitRepos`: array of git repository status objects
- `arcStatus`: arc working copy status object
- `errors`: array of error objects (if any)
- `operations`: array of operations performed (if successful)

## Example

```bash
# Check and reset all repositories
node projects/devduck/modules/vcs/scripts/new.js
```

Or via Cursor command:
```
/new
```

If there are uncommitted changes, the output will show:
```json
{
  "ok": false,
  "errors": [
    {
      "repo": "git:github.com/holiber/devduck",
      "projectName": "devduck",
      "type": "uncommitted",
      "files": ["scripts/new.js", "modules/vcs/commands/new.md"]
    },
    {
      "repo": "arc:current-working-copy",
      "type": "untracked",
      "files": [".cache/temp.txt"]
    }
  ]
}
```

