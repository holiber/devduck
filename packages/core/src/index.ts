/**
 * @barducks/core (workspace package placeholder).
 *
 * Today the monorepo runtime still lives under `src/`.
 * This entrypoint exists to stabilize the future package topology:
 * - @barducks/sdk — extension authoring API
 * - @barducks/core — extension execution / runtime
 * - @barducks/cli — CLI wrapper
 */

export * from '../../../src/lib/api.js';
export * from '../../../src/lib/extensions-discovery.js';
export * from '../../../src/install/runner.js';

