## Summary

Fix the PR "CI Metrics Dashboard" comment so **test metrics** are compared against the baseline (main) instead of showing no comparison.

- Compute baseline deltas for:
  - Unit tests: total tests and duration
  - E2E installer tests: total tests and duration
- Render these deltas in:
  - PR comment table (Δ vs main)
  - GitHub Pages HTML dashboard (Δ vs baseline)

## Notes

This change improves PR feedback by making test performance changes visible alongside other CI metrics.

