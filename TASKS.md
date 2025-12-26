# TASKS

Source of truth for task tracking. Keep tasks short. Prefer small, testable increments.

Commands:
- `npm run tasks -- list`
- `npm run tasks -- add "title" --prio P2`
- `npm run tasks -- claim T001 --owner Lead`
- `npm run tasks -- done T001 --note "shipped"`
- `npm run tasks -- summary`

Conventions:
- **status**: `open` → `claimed` → `done`
- **prio**: `P0` (urgent) … `P3` (nice-to-have)
- **owner**: bot name or `-`

<!-- TASKS:BEGIN -->
| id | status | prio | owner | title | note |
|---:|:------:|:----:|:-----:|:------|:-----|
| T001 | open | P0 | - | Locate/confirm where `agent` + HeartBeat live in the workspace | |
| T002 | open | P0 | - | Run HeartBeat “single run” smokecheck (once available) | |
| T003 | open | P1 | - | Ops report: token locations + store token + install costs + competitor installs | |
| T004 | open | P1 | - | Leader: draft 1 paid message to customer (questions + next actions) | |
| T005 | open | P2 | - | Implement minimal local task system (this file + `tools/tasks.js`) | bootstrap |
<!-- TASKS:END -->

