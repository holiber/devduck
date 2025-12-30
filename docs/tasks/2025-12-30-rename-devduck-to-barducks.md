# Task: Rename DevDuck to Barducks

## Summary

This change updates the codebase naming from **DevDuck** to **Barducks**:

- Rename remaining `devduck` references to `barducks` in code, docs, and configs.
- Align workspace config keys and prefixes with the current YAML-based workspace format.
- Update internal references used by installer/scripts/tests.

## Rationale

The project has been renamed to Barducks. Keeping legacy `devduck` naming causes confusion and can break tooling that expects Barducks naming (e.g., paths, config keys, and documentation links).

## Notes

- This is primarily a mechanical rename across the repository.
- Tests were run locally (`npm test`) before pushing.

