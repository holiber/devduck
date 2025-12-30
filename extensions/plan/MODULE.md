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

## External Providers

- Issue tracker providers - uses issue tracker API for loading issues (provided by external modules)

