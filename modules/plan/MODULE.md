---
name: plan
version: 0.1.0
description: Implementation plan creation and management for Tracker issues
tags: [plan, tracker, implementation]
dependencies: [core, ya-tracker]
---
# Plan Module

Module for creating and managing implementation plans for Tracker issues.

## Features

- Plan generation from Tracker issues
- Resource discovery and loading
- Plan execution tracking
- Plan status monitoring

## Usage

Create plan for issue:
```bash
node scripts/plan.js <issueKey>
```

Or use Cursor command:
```bash
/plan <issueKey>
```

## Dependencies

- `core` - uses `prompt-store` for prompt queue
- `ya-tracker` - uses tracker API for loading issues

