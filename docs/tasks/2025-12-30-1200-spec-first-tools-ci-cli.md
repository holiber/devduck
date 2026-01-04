---
title: Spec-first Tools API (core libs) + CI migration + unified api-cli improvements
date: 2025-12-30
---

## Summary

Refactored Barducks extensions API to a **spec-first** model for CI as a reference implementation:

- Added core libraries to define tools declaratively (schemas + meta) and auto-generate routers/providers.
- Migrated `extensions/ci` to use a single source of truth (`spec.ts`).
- Refactored CI providers to use `defineProvider(...)` and avoid manifest duplication.
- Improved unified `api-cli` to support dotted procedure paths (including vendor paths) and to build help from spec/registry.

## Motivation

Previously, tool lists and metadata were duplicated across:

- extension `api.ts` router definitions
- contract files (`schemas/contract.ts`) with tool lists/descriptions
- provider manifests and implementations

This caused drift risk, copy-paste overhead, and unstable CLI help generation.

## Changes

### Core libs

- (Removed later) `src/lib/tool-spec.ts` was an experiment for tool definitions/metadata; the repo now uses direct zod + `publicProcedure` instead.
- Added `src/lib/make-provider-router.ts` to auto-generate provider routers from tool specs.
- Added `src/lib/define-provider.ts` to define providers declaratively, auto-building `manifest.tools` and `manifest.vendorTools`.

### CI module

- Added `extensions/ci/spec.ts` as the single source of truth (tools + meta + examples + provider requirements).
- Made `extensions/ci/api.ts` thin and generated from spec via `makeProviderRouter(...)`.
- Removed duplicated tool lists/descriptions from `extensions/ci/schemas/contract.ts`.

### Providers

- Refactored `extensions/ci/providers/smogcheck-provider/index.ts` to use `defineProvider(...)`.
- Refactored `extensions/ci-github/providers/github-provider/index.ts` to use `defineProvider(...)`.

### Unified CLI

- Extended `src/lib/api.ts` with `collectUnifiedAPIEntries/getUnifiedAPIEntries` to collect routers + load `spec.ts` when present.
- Refactored `src/api-cli.ts`:
  - supports `module + dotted procedure path` (including `vendor.<ns>.<method>`)
  - builds help from spec when available, with fallback for legacy modules
  - uses spec-provided `requiresProvider/providerType` instead of heuristics
- Added `src/lib/extensions-discovery.ts` (`collectExtensionsDirs`) to centralize repo scanning logic.
- Added `src/lib/api-cli/runtime.ts` and `src/lib/api-cli/help-formatter.ts` to split responsibilities.

### Docs

- Added `docs/how-to-write-an-extension.md` documenting the spec-first extension structure and examples.

## Testing

- `npm test`

## Follow-ups

- Migrate other provider-based extensions (`email`, `issue-tracker`, `messenger`) to spec-first.
- Extend vendor tool support in specs (as soon as vendor-only methods exist in real providers).

