## Summary

Standardize Cursor Cloud Agent behavior for a **single-task** PR workflow (barducks 🦆):

- One task = one branch + one PR
- Mandatory stage-by-stage **commit/push checkpoints**
- A single continuously-updated PR **service status comment** (no comment spam)
- A single task report file `docs/<short-task-name>.md`

Deliverables:

- `docs/agent-workflow.md` (official instructions + comment template + allowed status state machine)
- `docs/_task-template.md` (task doc template)
- Cursor rules to enforce the workflow for the agent

