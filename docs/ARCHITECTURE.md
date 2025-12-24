# Devduck Architecture

## Overview

Devduck is a modular AI-powered development tool that helps developers automate routine tasks. The architecture is based on a plugin system where functionality is organized into modules.

## Module System

### Module Structure

Each module in `devduck/modules/` follows a standard structure:

```
module-name/
├── MODULE.md          # Module metadata and configuration (YAML frontmatter)
├── hooks.js          # Module installation hooks (optional)
├── mcp.json          # MCP server configurations (optional)
├── scripts/          # Module-specific scripts
├── commands/         # Cursor commands (copied to .cursor/commands/)
├── rules/            # Cursor rules (merged into .cursor/rules/)
├── apps/             # Executable applications
└── agents/           # AI agent definitions
```

### Module Configuration (MODULE.md)

Each module must have a `MODULE.md` file with YAML frontmatter:

```yaml
---
name: module-name
version: 0.1.0
description: Module description
tags: [tag1, tag2]
dependencies: [core, other-module]
defaultSettings:
  settingName: value
  multilineSetting: |
    Multi-line content
---
# Module Documentation

Module description and usage instructions.
```

**Fields:**
- `name`: Unique module identifier
- `version`: Module version
- `description`: Brief module description
- `tags`: Array of tags for categorization (e.g., `vcs`, `yandex`, `security`)
- `dependencies`: Array of module names this module depends on
- `defaultSettings`: Module-specific default settings (e.g., `cursorignore`, `arcignore`)

### Module Types

#### Core Module
- **Name**: `core`
- **Purpose**: Essential devduck functionality, always available
- **Dependencies**: None
- **Special**: Automatically included in all workspace installations

#### Cursor Module
- **Name**: `cursor`
- **Purpose**: Cursor IDE integration (commands, rules, MCP configuration)
- **Dependencies**: `[core]`
- **Special**: Automatically included in all workspace installations

#### Yandex Infrastructure Modules
Modules related to Yandex infrastructure must start with `ya-` prefix:
- `ya-arc`: Yandex Arcadia integration
- `ya-security`: Security checks and PR policies

#### Other Modules
- `containers`: Docker container orchestration
- `evolution`: Self-modification capabilities
- `unsecure-sudo`: Temporary sudo command execution

## Workspace System

### Workspace Structure

A workspace is a directory containing:

```
workspace/
├── workspace.config.json  # Workspace configuration
├── devduck/               # Link or copy to devduck tool
├── .cursorignore          # Created by core module hooks
├── .arcignore            # Created by ya-arc module hooks (if installed)
├── .cache/
│   └── devduck/          # Temporary files (fixed path)
└── .cursor/
    ├── commands/          # Installed module commands
    ├── rules/             # Merged module rules
    └── mcp.json           # Generated MCP configuration
```

### Workspace Configuration

`workspace.config.json` is the workspace “source of truth”. It drives:

- **Module installation**: which modules to install and how they are configured
- **External module sources**: additional repositories to load modules from
- **Project setup**: which repositories/folders should appear under `projects/`
- **Checks & MCP**: checks to run, plus generation of `.cursor/mcp.json`
- **Environment**: what to write into the workspace `.env` file

`workspace.config.json` structure (v0.1.0):

```json
{
  "workspaceVersion": "0.1.0",
  "devduckPath": "./devduck",
  "modules": ["core", "cursor"],
  "moduleSettings": {
    "module-name": {
      "settingName": "override value"
    }
  },
  "repos": ["github.com/org/custom-devduck-modules"],
  "projects": [
    {
      "src": "arc://junk/user/my-service",
      "checks": [
        {
          "name": "node",
          "description": "Node.js is installed",
          "test": "node --version",
          "tier": "pre-install"
        }
      ]
    }
  ],
  "checks": [
    {
      "name": "my-mcp-server",
      "description": "Expose MCP server to Cursor",
      "mcpSettings": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-git"]
      }
    }
  ],
  "env": [
    {
      "name": "GITHUB_TOKEN",
      "description": "Used by GitHub integration scripts",
      "default": ""
    }
  ]
}
```

**Fields:**
- **`workspaceVersion`**: workspace config version string (currently `0.1.0`)
- **`devduckPath`**: path to the Devduck installation (relative to workspace root); used by tooling to locate scripts/modules
- **`modules`**: list of module names to install; supports `["*"]` to mean “all available modules”
- **`moduleSettings`**: per-module settings override, merged on top of each module’s `defaultSettings`
- **`repos`**: list of external repositories to load additional modules from (Git or Arcadia URLs)
- **`projects`**: list of projects that should be available under `projects/` (via symlink/clone)
- **`checks`**: workspace-level checks to run (and the source for generating `.cursor/mcp.json`)
- **`env`**: a list of environment variables to write into the workspace `.env`

#### Variable expansion in config

Some string fields support variable expansion using the `$$VARNAME$$` syntax (resolved from `process.env` first, then the workspace `.env`). This is used for check commands and MCP settings.

#### `projects[]`

Each project entry supports multiple source types:

- **Arcadia**: `{ "src": "arc://path/in/arcadia" }` or legacy `{ "path_in_arcadia": "path/in/arcadia" }`  
  The installer creates a symlink under `projects/<name>` pointing into the Arcadia checkout (uses `$ARCADIA` from `.env`/environment).
- **Local folder**: `{ "src": "./relative/path" }` or `{ "src": "/absolute/path" }`  
  The installer creates a symlink under `projects/<name>` to that folder.
- **GitHub/Git**: `{ "src": "github.com/org/repo" }`, `{ "src": "https://github.com/org/repo.git" }`, or `{ "src": "git@github.com:org/repo.git" }`  
  The installer clones into `projects/<name>` (and pulls if already cloned).

Projects can also define `checks[]` which are executed in the project context (working directory is `projects/<name>` when possible).

#### `checks[]` and `projects[].checks[]`

Checks are objects with (common) fields:

- **`name`**: unique human-readable name
- **`description`**: optional free text
- **`test`**: command string (or an HTTP request string like `"GET https://..."`)  
  If `test` looks like a file path, it is treated as “file/directory must exist”.
- **`install`**: optional command to run if `test` fails (in non-interactive mode the installer auto-runs the install command)
- **`tier`**: optional tier label used to order checks (default `pre-install`)
- **`skip`**: optional boolean to force skip
- **`mcpSettings`**: if present, this check contributes an entry to `.cursor/mcp.json` under `mcpServers[name]`

#### `env[]`

Each env entry is an object:

- **`name`** (or legacy **`key`**): environment variable name
- **`default`** (or legacy **`value`**): default value used when generating `.env`
- **`description`** (or legacy **`comment`**): shown to the user during interactive `.env` setup

## Module Installation Process

1. **Read workspace.config.json** - Load workspace configuration
2. **Load external repositories** - If `repos` specified, load modules from external sources
   - Parse repository URLs (git, arcadia)
   - Check version compatibility via manifest.json
   - Add module sources to resolver
3. **Resolve module list** - Handle `*` wildcard, resolve dependencies
4. **Ensure core and cursor modules** - Both are always included
5. **Load modules** - Parse MODULE.md, collect resources from all sources
6. **Check for conflicts** - Verify no duplicate module names across sources
7. **Merge settings** - Combine defaultSettings with workspace moduleSettings
8. **Execute hooks**:
   - **pre-install**: Check prerequisites
   - **install**: Module-specific installation (e.g., create `.cursorignore`, `.arcignore`)
   - **post-install**: Finalize installation (e.g., cursor module copies commands/rules, generates mcp.json)
9. **Create cache directory** - `.cache/devduck/` (fixed path)
10. **Run checks** - Execute module-specific and workspace checks

**Note**: Cursor IDE integration (commands, rules, mcp.json) is handled by the `cursor` module's `post-install` hook, not by workspace-installer directly.

## Module Dependencies

Modules can declare dependencies on other modules:

```
core (no dependencies, always available)
  ↑
  ├── cursor (depends on core, always available)
  │
  ├── ya-arc (depends on core)
  │     ↑
  │     └── ya-security (depends on ya-arc)
  │
  ├── containers (depends on core)
  │
  ├── evolution (depends on core)
  │
  └── unsecure-sudo (depends on core)
```

**Important**: 
- Core module is always available to all modules, even if not explicitly listed in dependencies
- Cursor module is always included in workspace installations (like core) to handle Cursor IDE integration

## Module Access

### Accessing Core Module

Modules can access core module utilities using relative paths:

```javascript
const { executeCommand } = require('../../core/scripts/utils');
```

### Module Resolution

The module resolver provides helper functions to resolve module paths:

```javascript
const { resolveModulePath } = require('./module-loader');
const coreUtilsPath = resolveModulePath('core', 'scripts/utils.js');
```

## External Module Repositories

DevDuck supports loading modules from external repositories, allowing you to extend functionality with custom modules or use modules from other sources.

### Repository Formats

External repositories can be specified in several formats:

- **Git repositories**: 
  - `git@github.com:user/repo.git`
  - `github.com/user/repo`
- **Arcadia repositories**:
  - `arc://path/to/repo` (e.g., `arc://junk/user/modules`)
  - `a.yandex-team.ru/arc/path/to/repo`

### Repository Structure

External repositories must follow this structure:

```
repository-root/
├── modules/
│   └── module-name/
│       ├── MODULE.md
│       └── ...
└── manifest.json (or devduck.manifest.json)
```

### Manifest File

Each external repository must include a `manifest.json` or `devduck.manifest.json` file:

```json
{
  "devduckVersion": "0.1.0"
}
```

The `devduckVersion` must exactly match the DevDuck version from `package.json`. The installer will check this before loading modules and report an error if versions don't match.

### Version Compatibility

- Main DevDuck version is read from `package.json.version`
- External repository version is read from `manifest.json.devduckVersion` or `devduck.manifest.json.devduckVersion`
- Versions must match exactly (strict comparison)
- Mismatch results in installation error with clear message

### Module Source Resolution

The module resolver supports multiple sources:

1. **Default source**: `devduck/modules/` (main repository)
2. **External sources**: Added via `addModuleSource()` for each external repository
3. **Conflict detection**: Module names must be unique across all sources
4. **Search order**: First match wins when searching for modules

### Repository Loading Process

1. Parse repository URL to determine type (git/arcadia)
2. Resolve to local path:
   - **Git**: Clone to `.cache/devduck/repos/{repo-name}/` (reused if exists)
   - **Arcadia**: Use direct filesystem path
3. Check for `manifest.json` or `devduck.manifest.json`
4. Verify version compatibility
5. Locate `modules/` directory
6. Add to module sources via `addModuleSource()`

### Usage

#### Via CLI

```bash
node scripts/workspace-installer.js --repos "github.com/user/modules,arc://path/to/modules"
```

#### Via Configuration

```json
{
  "repos": [
    "github.com/user/custom-modules",
    "arc://junk/user/other-modules"
  ]
}
```

## Module Hooks System

Modules can define installation hooks in `hooks.js` to customize their installation process. This allows external modules from other repositories to integrate without modifying `workspace-installer.js`.

### Hook Stages

1. **pre-install**: Check prerequisites (dependencies, tokens, software)
   - Executed before installation
   - Can warn but should not block installation
   - Example: Check if required tools are installed

2. **install**: Perform installation actions
   - Main installation step
   - Example: Create configuration files, copy resources

3. **test**: Test module functionality
   - Can be run separately: `node scripts/install.js --test-module <moduleName>`
   - Verifies module works correctly
   - Example: Test API access, verify commands work

4. **post-install**: Finalize after all modules installed
   - Executed after all modules are installed
   - Has access to all installed modules
   - Example: Final configuration based on other modules

### Hook Implementation

Hooks are defined in `modules/<module-name>/hooks.js`:

```javascript
module.exports = {
  async 'pre-install'(context) {
    // context: { workspaceRoot, modulePath, moduleName, settings, allModules, cacheDir, cursorDir }
    return { success: true };
  },
  
  async 'install'(context) {
    // Create files, configure environment
    return {
      success: true,
      createdFiles: ['.cursorignore']
    };
  },
  
  async 'test'(context) {
    // Test module functionality
    return { success: true };
  },
  
  async 'post-install'(context) {
    // Finalize installation
    return { success: true };
  }
};
```

### Hook Context

The context object passed to hooks contains:
- `workspaceRoot`: Workspace root directory
- `modulePath`: Path to module directory
- `moduleName`: Module name
- `settings`: Merged module settings (defaultSettings + workspace overrides)
- `allModules`: Array of all installed modules (for post-install)
- `cacheDir`: `.cache/devduck` directory
- `cursorDir`: `.cursor` directory
- `commandsDir`: `.cursor/commands` directory
- `rulesDir`: `.cursor/rules` directory

### File Creation During Installation

Files are created by module hooks, not hardcoded in the installer:

- **.cursorignore**: Created by `core` module's `install` hook from `settings.cursorignore`
- **.arcignore**: Created by `ya-arc` module's `install` hook from `settings.arcignore`
- **.cursor/commands/**: Created by `cursor` module's `post-install` hook (copies commands from all modules)
- **.cursor/rules/devduck-rules.md**: Created by `cursor` module's `post-install` hook (merges rules from all modules)
- **.cursor/mcp.json**: Created by `cursor` module's `post-install` hook (generates from all module MCP configs)

This allows any module to create files during installation by defining appropriate hooks.

## Cache Management

All temporary files are stored in `.cache/devduck/` directory within the workspace:
- **Fixed path**: Not configurable, always `.cache/devduck/`
- **Workspace-aware**: Scripts detect workspace and use workspace cache path
- **Isolation**: Each workspace has its own cache directory

## Module Development

### Creating a New Module

1. Create module directory: `modules/my-module/`
2. Create `MODULE.md` with YAML frontmatter
3. Add module resources (scripts, commands, rules, etc.)
4. Declare dependencies in MODULE.md
5. Add module to workspace.config.json if needed

### Module Best Practices

- Keep modules focused on a single responsibility
- Use tags for categorization
- Declare all dependencies explicitly
- Provide defaultSettings for configurable behavior
- Document module usage in MODULE.md
- Follow naming conventions (ya-* for Yandex infrastructure)

## Architecture Evolution

For information about architecture changes and evolution, see `ARCHITECTURE.md` in the project root. The evolution module provides capabilities for self-modification of devduck.

