---
alwaysApply: false
globs: ["**/ARCHITECTURE.md", "**/extensions/**/MODULE.md", "**/workspace.config.yml", "**/migration-plan.md"]
---
# Architecture Documentation Rule

## Rule

When working with barducks architecture, module system, or workspace configuration:

- **Always refer to `ARCHITECTURE.md`** in the project root for architectural information
- The architecture documentation contains:
  - Module system structure and conventions
  - Workspace system design
  - Module installation process
  - Dependency resolution
  - File creation during installation
  - Cache management
  - Module development guidelines

## Usage

When making changes to:
- Module structure
- Workspace system
- Module installation process
- Module dependencies
- Cache management

**First read `ARCHITECTURE.md`** to understand the current architecture and ensure changes are consistent with the design.

## Evolution Module

The evolution module enables barducks to make changes to itself. When evolving the architecture:

1. Read `ARCHITECTURE.md` to understand current state
2. Plan changes according to architecture principles
3. Update `ARCHITECTURE.md` to reflect changes
4. Ensure backward compatibility when possible
5. Document all architectural changes

