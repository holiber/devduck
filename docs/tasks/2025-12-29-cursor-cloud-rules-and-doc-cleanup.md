## Summary

This change makes Cursor Cloud able to follow repository rules by committing `.cursor/` and adding a project rule reminding contributors to follow `CONTRIBUTING.md` when opening PRs.

It also cleans up duplicated documentation files:

- Keep a single `CONTRIBUTING.md` in the repository root (and fix references to it).
- Merge `docs/CHANGELOG.md` into the root `CHANGELOG.md` and remove the duplicate file.

## Notes

- Added `docs/PHILOSOFY.md` as a placeholder (`TODO`).

