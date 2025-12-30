---
name: dashboard
version: 0.1.0
description: Interactive terminal dashboard for monitoring Barducks tasks
tags: [dashboard, tui, monitoring]
dependencies: [core]
---
# Dashboard Module

Module providing interactive terminal dashboard (TUI) for monitoring Barducks tasks.

## Features

- Real-time task monitoring
- Queue status
- Container statistics
- Task details view
- Search and filtering

## Usage

Run dashboard:
```bash
node scripts/dashboard.js
```

Or use Cursor command:
```bash
/dashboard
```

## Dependencies

- `core` - uses `prompt-store` for prompt queue monitoring

