# Dashboard

Interactive terminal dashboard (TUI) for DevDuck tasks under `.cache/tasks/`.

Usage:

```bash
/dashboard
```

Or run directly:

```bash
node scripts/dashboard.js
```

## What it shows

- **Tasks**: read from `.cache/tasks/<taskId>/task.json`
- **Queue**: `.cache/tasks/.queue/queue.json`, `.cache/tasks/.queue/state.json`, `.cache/tasks/.queue/bg.pid`
- **Containers**: Docker `devduck-worker-*` and `plan-*` with lightweight live stats
- **Events**: derived from recent `task.json.runs[]`
- **SP / readiness** (optional): derived from `task.json.estimates.*` history (e.g. after running `/task estimate-my <taskId>` multiple times)

## Keybindings

- `↑/↓` — navigate tasks
- `Enter` — open task details
- `/` — search/filter (by id/status/stage/ticket/summary)
- `t` — toggle “problematic only” (`failed`, `needs_manual`)
- `q` — quit

### In task details view

- `o` — open task folder
- `l` — view latest log (tail)
- `r` — requeue task (`/task enqueue <taskId>`)
- `b` / `Esc` — back


