#!/usr/bin/env node

/**
 * CI module API - router definition (tRPC-like)
 *
 * NOTE: The source of truth is `extensions/ci/spec.ts`.
 */

import { makeProviderRouter } from '@barducks/sdk';
import { ciTools, ciVendorTools } from './spec.js';

export const ciRouter = makeProviderRouter({
  tools: ciTools,
  vendorTools: ciVendorTools
});

