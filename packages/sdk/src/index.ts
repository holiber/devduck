/**
 * Barducks SDK (workspace package).
 *
 * This package is intentionally a thin re-export layer over the current
 * monorepo sources under `src/`. This enables short imports in extensions:
 *
 *   import { createYargs } from '@barducks/sdk';
 *
 * Once the codebase is fully split into `@barducks/core|cli|sdk`, these
 * re-exports can be replaced with real package-local implementations.
 */

export * from '../../../src/lib/cli.js';
export * from '../../../src/lib/env.js';
export * from '../../../src/lib/config.js';
export * from '../../../src/lib/workspace-root.js';
export * from '../../../src/lib/workspace-config.js';
export * from '../../../src/lib/barducks-paths.js';

export * from '../../../src/lib/provider-router.js';
export * from '../../../src/lib/make-provider-router.js';
export * from '../../../src/lib/provider-registry.js';
export * from '../../../src/lib/tool-spec.js';
export * from '../../../src/lib/define-provider.js';

export * from '../../../src/install/module-hooks.js';
export * from '../../../src/utils.js';

// Extension protocol contracts (stable types/constants for external modules).
export * from '../../../extensions/ci/schemas/contract.ts';
export * from '../../../extensions/issue-tracker/schemas/contract.ts';
export * from '../../../extensions/email/schemas/contract.ts';
export * from '../../../extensions/messenger/schemas/contract.ts';
