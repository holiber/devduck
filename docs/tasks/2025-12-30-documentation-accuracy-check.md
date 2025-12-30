## Summary

Update `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` to accurately reflect the current codebase and CI practices.

The `ARCHITECTURE.md` document was significantly out of sync with the current repository state, particularly regarding the "extensions" system, `workspace.config.yml` schema, and installer pipeline. This PR rewrites it to match the actual implementation. `CONTRIBUTING.md` also lacked crucial information about CI requirements and Node.js versions.

## Changes

- **ARCHITECTURE.md**: Complete rewrite to accurately document:
  - Extensions system and how it works
  - `workspace.config.yml` schema and validation
  - Installer pipeline and project setup flow
  - Current directory structure and module organization

- **CONTRIBUTING.md**: Added missing information about:
  - CI requirements and workflow expectations
  - Node.js version requirements
  - Testing and quality standards
  - PR guidelines and task file requirements

## Notes

This is a documentation-only change that brings the project documentation in line with the actual implementation.
