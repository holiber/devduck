## Summary

Improve PR feedback for the **CI Metrics Dashboard** comment:

- Post the comment immediately with a **BUILDING** badge on the first run.
- When a new commit is pushed and CI restarts, add a **REBUILDING** badge while showing metrics from the last successful run (if any).
- If CI fails, show a **FAIL** badge and clarify that the metrics shown are from the last successful run (if any).

