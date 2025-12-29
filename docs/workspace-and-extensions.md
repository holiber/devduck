# Workspace and extensions in Barducks (simple explanation)

## What is a **workspace** in Barducks?

A **workspace** is a directory that acts as a container for your Barducks setup.
Inside a workspace, Barducks:

- keeps the **single source of truth** config: `workspace.config.yml`;
- links/clones your projects (typically under `projects/`);
- installs and generates IDE/agent integration artifacts (for example, `.cursor/commands`, `.cursor/rules`, `.cursor/mcp.json`);
- stores working artifacts and caches (for example, `.cache/`).

In other words, **a workspace is the unit of installation and configuration** for Barducks. It’s also easy to share within a team by sharing a `workspace.config.yml`.

## What is an **extension** in Barducks?

An **extension** is simply a bundle of tools that extends Barducks functionality.
An extension can contribute, for example:

- **AI agent rules** (rules);
- **AI agent / IDE commands** (commands);
- **MCP servers** and/or their configuration;
- **additional APIs** (extension procedures/routers available to CLI/scripts).

Extensions may also include scripts, installation hooks, provider implementations, templates, and other resources — but conceptually it’s still just an “extension pack”.

## Built-in extensions

Below is the list of extensions that ship with this repository.

| Extension | What it does | Notes |
| --- | --- | --- |
| `core` | Base Barducks infrastructure used by other extensions | Special-cased: provides core resources/foundation |
| `cursor` | Cursor IDE integration: commands, rules, `.cursor/mcp.json` generation | Recommended when using Cursor |
| `containers` | Docker orchestration for isolation / parallel plan generation | Requires Docker (unless already inside a container) |
| `ci` | Unified CI interface via provider system (PR, checks, comments) | Providers can come from other extensions/repos |
| `ci-github` | GitHub provider for `ci` | Requires `GITHUB_TOKEN` |
| `dashboard` | Interactive terminal dashboard (TUI) | Includes `/dashboard` command |
| `email` | Unified email interface via provider system | Includes `/email` command |
| `email-gmail` | Gmail provider for `email` | Depends on provider auth setup |
| `evolution` | Self-evolution / modifying Barducks itself | References architecture docs/rules |
| `git` | Git integration: `.gitignore` generation | Common baseline extension for most workspaces |
| `github-ci` | GitHub Actions setup + CI status checks | Includes `/github-setup-ci` command |
| `issue-tracker` | Unified issue tracker interface via provider system (issue/comments/PR/resources) | Providers are modular |
| `issue-tracker-github` | GitHub provider for `issue-tracker` | Requires `GITHUB_TOKEN` |
| `messenger` | Unified messenger interface via provider system (chats/history/files) | Caches under `.cache/barducks/messenger/` |
| `messenger-telegram` | Telegram provider for `messenger` | Default is mock mode; TDLib recommended |
| `messenger-yandex-messenger` | Yandex Messenger provider for `messenger` | Default is mock mode |
| `plan` | Implementation plan generation and tracking | Includes `/plan <issueKey>` command |
| `playwright` | Testing utilities/guidelines (including VHS flows) | Adds `vhs*` scripts to workspace `package.json` |
| `unsecure-sudo` | Temporary sudo command execution (unsafe) | Use with caution |
| `vcs` | VCS-agnostic commit/PR conventions | VCS-specific tooling (git/arc) can be external |

## How to add more extensions

### Option 1: Connect an external extensions repository

In `workspace.config.yml`, you can specify additional extension sources via `repos:` (Git or Arcadia). Barducks will load extensions from those repos during workspace installation.

You can also pass repos via CLI (for example, `node install.js --repos ...`).

### Option 2: Create extensions inside the workspace

You can create extensions directly in the workspace by putting them under:

- `./extensions/<your-extension>/...` (workspace-local extensions)
- `./projects/<project>/extensions/<your-extension>/...` (extensions living next to a specific project)

Important: **workspace-local extensions take precedence** over built-in ones — great for customization and extension development.

