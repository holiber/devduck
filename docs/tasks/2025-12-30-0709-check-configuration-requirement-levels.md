# Check Configuration Update: Requirement Levels and Conditional Execution

**Date:** 2025-12-30  
**Status:** In Progress  
**PR:** #102

## Objective

Introduce `when` field and `requirement` levels for checks to enable conditional execution and define installation strictness.

## Background

The current check system uses a boolean `optional` field which provides only two states: required or optional. This is insufficient for expressing nuanced installation behavior where some checks should warn but continue, or be conditionally executed based on environment state.

## Changes

### 1. Requirement Levels

Replace the boolean `optional` field with a `requirement` field supporting three levels:

- **`required`** (default): Stops installation on failure
- **`recommended`**: Warns on failure, continues installation  
- **`optional`**: Skips installation attempt entirely

### 2. Conditional Execution

Add a `when` field that allows checks to be conditionally skipped based on a shell command's exit code:

```yaml
checks:
  - name: docker-check
    when: command -v docker
    requirement: recommended
```

### 3. Backward Compatibility

Maintain backward compatibility by converting the old `optional: true` to `requirement: optional`.

## Implementation Tasks

- [x] Update workspace config schema with `requirement` and `when` fields
- [x] Update TypeScript types for check configuration
- [x] Add backward compatibility for `optional` field migration
- [x] Update module resolver to handle new fields
- [ ] Implement `when` condition evaluation logic
- [ ] Implement requirement level handling in installation flow
- [ ] Add tests for requirement levels
- [ ] Add tests for conditional execution
- [ ] Update documentation

## Testing

- Unit tests for schema validation
- Unit tests for backward compatibility
- Integration tests for requirement level behavior
- Integration tests for conditional execution

## Documentation

- Update workspace configuration documentation
- Add examples for different requirement levels
- Document migration path from `optional` to `requirement`
