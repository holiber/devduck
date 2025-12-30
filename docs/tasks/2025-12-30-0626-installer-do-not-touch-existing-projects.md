## Summary

The installer must **not modify** entries under `projects/` if they already exist locally.

This prevents local work from being overwritten (e.g. by re-cloning, re-linking, or running `git pull`).

## Change

- Step 3 (`download-projects`) now **skips** any project that already exists in `projects/<projectName>`.
- For git-based projects, Step 3 no longer attempts to update existing checkouts (`git pull` is not executed).

## Notes

- This change is intentionally conservative: if a path exists in `projects/`, the installer leaves it untouched.
