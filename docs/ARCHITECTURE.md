# Barducks Architecture

<!--
This document describes the repository *as it exists today*.
If you change behavior (installer steps, config keys, folder names), update this file too.
-->

## Terms (glossary)

- **Workspace**: a directory that contains `workspace.config.yml` and generated/installed artifacts for a team/project.
- **Extension**: a bundle of functionality under `extensions/<name>/...` (metadata, hooks, rules/commands, APIs, providers, etc.).
- **Legacy naming note**: parts of the code still use the word “module” internally (file names, types, step ids), but the public concept is **extensions**.

## Repository layout (high level)

This repository is a Node.js/TypeScript project:

- `src/`: typed implementation (installer engine, unified API, utilities).
- `scripts/`: runnable entrypoints that import `src/*` (executed via `tsx`).
- `extensions/`: built-in extensions shipped in this repo.
- `defaults/`: baseline workspace config fragments (used via `workspace.config.yml -> extends`).
- `tests/`: unit tests + Playwright installer tests.

## Extension system

### Extension structure

Built-in extensions live in `extensions/<extension-name>/`. A typical extension can include:

```
extensions/<name>/
├── MODULE.md          # Extension metadata (YAML frontmatter) + docs
├── hooks.ts           # Installer hooks (optional; hooks.js also supported)
├── api.ts             # Unified API router (optional)
├── commands/          # Cursor command markdown files (optional)
├── rules/             # Cursor rule markdown files (optional)
├── providers/         # Provider implementations (optional, per extension contract)
├── scripts/           # Extension-specific scripts (optional)
├── templates/         # Templates used by hooks/commands (optional)
└── apps/              # Executable apps/tools (optional)
```

### Extension metadata (`MODULE.md`)

Extensions are discovered by parsing YAML frontmatter from `extensions/<name>/MODULE.md`.
The loader parses the first `--- ... ---` frontmatter block.

Common metadata fields (permissive / best-effort):

- `name`: extension id (defaults to folder name).
- `version`: extension version (defaults to `0.1.0` if missing).
- `description`: short description.
- `tags`: string array.
- `dependencies`: other extension names this extension depends on.
- `defaultSettings`: per-extension defaults (merged with `workspace.config.yml -> extensionSettings`).
- `checks`: checks to run during installation (see “Checks” below).
- `mcpSettings`: optional MCP server configs (used by the `cursor` extension hook; legacy support also exists via per-extension `mcp.json`).

### Extension selection and dependency resolution

Workspace config selects extensions via `workspace.config.yml -> extensions`.

Selectors supported by the resolver:

- `["*"]`: all discovered extensions.
- glob-like patterns with `*` / `?` (e.g. `"messenger-*"`).
- exact extension names.

Dependency behavior:

- `dependencies` from `MODULE.md` are added automatically.
- `core` is always added if it exists.
- `git` is always added if it exists.
- `cursor` is **not** forcibly added by the resolver (but is commonly present in default configs).

### Extension source priority

When multiple sources provide the same extension name, the first one wins.
Current priority order during installation:

1. Workspace-local: `<workspaceRoot>/extensions/<name>`
2. Project-local: `<workspaceRoot>/projects/<project>/extensions/<name>`
3. External repos: repos listed under `workspace.config.yml -> repos` (each must contain `extensions/`)
4. Built-in: `<barducksRepo>/extensions/<name>`

## Workspace system

### Workspace layout

A workspace is “the unit of installation”. Typical layout:

```
<workspaceRoot>/
├── workspace.config.yml
├── .env
├── projects/
│   └── <projectName>/...
├── extensions/                 # workspace-local overrides (optional)
├── .cache/
│   ├── install.log
│   ├── install-state.json
│   └── taskfile.generated.yml  # generated runtime for go-task workflows
└── .cursor/
    ├── commands/
    ├── rules/
    └── mcp.json
```

### Workspace config: `workspace.config.yml`

The installer reads `workspace.config.yml` (or `workspace.config.yaml`) as YAML.
This file is treated as the workspace “source of truth”.

Key fields (simplified):

```yaml
version: "0.1.0"
barducks_path: "./projects/barducks"

extends:
  - barducks:defaults/workspace.install.yml

extensions:
  - core
  - cursor
  - git
  - ci-*

extensionSettings:
  ci:
    provider: github-provider

repos:
  - "https://github.com/example/custom-barducks-extensions.git"
  - "arc://junk/user/team-extensions"

projects:
  - src: "github.com/org/my-service"

checks:
  - name: "my-mcp-server"
    description: "Expose MCP server to Cursor"
    mcpSettings:
      command: "npx"
      args: ["-y", "@modelcontextprotocol/server-git"]

env:
  - name: "GITHUB_TOKEN"
    description: "Used by GitHub integrations"
    default: ""
```

#### `extends` (config composition)

`workspace.config.yml` supports `extends: [...]` to compose configs.

- Each entry can be an absolute path, a path relative to the config file, or a `barducks:`-prefixed path resolved relative to the Barducks root (from `barducks_path`).
- Merge behavior is “last one wins”, with special rules for arrays (`projects`, `checks`, `env` are de-duped by key).
- `extends` itself is not propagated into the resolved output.

#### Variable expansion

Many string fields support `$VARNAME` substitution.
Variables are resolved from `process.env` first, then from the workspace `.env`.

## Installer architecture

### Entrypoints

- `scripts/install.ts` is the thin entrypoint (intended to be executed via `tsx`).
- The core CLI orchestration lives in `src/install.ts`.

### Step pipeline

The default installer runs a fixed sequence of steps (ids are stable; some still say “modules”):

1. `check-env`
2. `download-repos`
3. `download-projects`
4. `check-env-again`
5. `setup-modules` (sets up **extensions**: loads them, executes hooks, runs extension checks)
6. `setup-projects`
7. `verify-installation`

Progress and results are persisted in `<workspaceRoot>/.cache/install-state.json`.

### Hooks

Extensions can implement `hooks.ts` (or `hooks.js`) and export hook functions by stage name:

- `pre-install`
- `install`
- `post-install`
- `test` (supported by the hook loader; not part of the default step pipeline today)

Hooks receive a context containing:

- workspace paths (`workspaceRoot`, `.cursor` dirs, `.cache/barducks`),
- the current extension name/path,
- merged extension settings,
- and `allModules` (all resolved extensions) for post-install stages.

## Checks

Checks can be declared in:

- `workspace.config.yml -> checks[]` (workspace-level),
- `workspace.config.yml -> projects[].checks[]` (project-level),
- `extensions/<name>/MODULE.md -> checks[]` (extension-level).

### Execution model

`test` supports:

- shell commands,
- HTTP checks of the form `"GET https://..."` / `"POST https://..."`,
- file/directory existence checks if `test` looks like a path.

If `install` is provided and the check fails, the installer can run the install command (auto-yes in non-interactive mode).

### Auth checks (`type: "auth"`)

The check engine supports a special auth mode:

- `type: "auth"` with `var: "TOKEN_NAME"` marks the check as token-gated.
- If the token is missing (in `process.env` and in `.env`), the check fails early and prints optional `docs` guidance.
- Auth checks still require a `test` command to validate the token.

### Optionality / requirement

Checks support:

- `requirement: required | recomended | recommended | optional`
- legacy `optional: true` (treated as `requirement: "optional"`)

## MCP (`.cursor/mcp.json`)

There are currently two sources of MCP configuration:

1. **Workspace checks with `mcpSettings`**: the installer can generate `.cursor/mcp.json` by collecting `checks[].mcpSettings`.
2. **The `cursor` extension post-install hook**: it writes `.cursor/mcp.json` based on each extension’s `MODULE.md -> mcpSettings` (and legacy per-extension `mcp.json`).

If the `cursor` extension is installed, its post-install hook currently runs during step 5 and writes `.cursor/mcp.json` again (overwriting any earlier generated file).

## External extension repositories (`repos:`)

Workspaces can load extensions from external repositories via `workspace.config.yml -> repos`.

Repository formats:

- Git URLs (including `https://github.com/...` and `git@github.com:...`)
- Arc working copy paths using `arc://...` (resolved via `ARC_ROOT` or `arc root`)

Each external repository must contain:

- `extensions/` directory at repo root,
- a manifest file: `barducks.manifest.json` (preferred) or `manifest.json` (legacy/testing).

Manifest format:

```json
{ "barducksVersion": "0.3.0" }
```

Version rule (as implemented):

- the repo is considered compatible if `manifest.barducksVersion <= package.json.version`.

## Unified API system

Extensions can expose APIs by exporting a router from `extensions/<name>/api.ts`.
Routers are collected into a single “unified API” object and can be invoked via the API CLI entrypoint.

The API collector:

- discovers extension routers under `extensions/`,
- discovers routers from external repos listed under `repos:`,
- loads `.env` into `process.env` (fill-missing) before importing routers,
- caches the collected API on first use.

