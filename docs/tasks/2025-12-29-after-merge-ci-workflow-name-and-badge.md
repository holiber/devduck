# AFTER MERGE CI workflow name + README badge

## Summary

- Renamed the CI workflow to start with `AFTER MERGE ...` for easier discovery in GitHub Actions.
- Added a GitHub Actions status badge to `README.md` for the `ci.yml` workflow on the `main` branch.

## Notes

- The CI workflow already runs on `push` to `main`, so it executes after every PR merge to `main`.

