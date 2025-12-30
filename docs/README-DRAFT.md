## Quick Start

### 1) Create a workspace

A workspace describes *what* you are working on — not *how* or *where*.

```bash
barducks workspace init
```

This creates a shared workspace configuration that may include:

- multiple repositories
- different repository types
- different execution environments

### 2) Add projects

```bash
barducks workspace add repo https://github.com/org/backend
barducks workspace add repo https://gitlab.com/org/frontend
barducks workspace add docs ./docs
```

BarDucks does not assume a single repository. Everything is treated as part of one logical system.

### 3) Run workflows

```bash
barducks commit
barducks pr
barducks test
```

You don’t need to care:

- which VCS is used
- where tests run
- which CI or AI provider is configured

BarDucks figures it out through extensions and providers.

### 4) Share the workspace

Commit the workspace config (file name depends on your setup):

```bash
git add workspace.config.yml
git commit -m "workspace: add workspace config"
```

A new teammate can bootstrap the same development context in minutes.

# README.md — Details (Concepts)

## Workspace

A workspace is a **logical development context**.

It may include:

- multiple repositories (GitHub, GitLab, local)
- different project types (backend, frontend, docs)
- different versions of the same product (open / closed)
- different execution environments

Workspaces are declarative, shareable, and reproducible.

## Extensions

BarDucks is built around **extensions**.

Extensions define:

- workflows (commit, PR, test, release)
- domain abstractions (VCS, CI, issues, AI, execution)
- rules and conventions

Extensions do not depend on specific tools. They depend on **abstract APIs**.

## Providers

Providers are concrete implementations of extensions.

For example:

- GitHub, GitLab → VCS providers
- CircleCI, Azure Pipelines → CI providers
- OpenAI, Claude, local models → AI providers
- Local machine, Docker, remote servers → execution providers

Providers can be swapped without changing workflows.