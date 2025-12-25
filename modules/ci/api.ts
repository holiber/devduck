#!/usr/bin/env node

/**
 * CI module API - tRPC-like router definition
 * This is the source of truth for CI module procedures
 */

import { z } from 'zod';
import { initProviderContract } from '../../scripts/lib/provider-router.js';
import type { CIProvider } from './schemas/contract.js';
import {
  FetchPRInputSchema,
  FetchCheckStatusInputSchema,
  FetchCommentsInputSchema,
  PRInfoSchema,
  CheckStatusSchema,
  CommentSchema
} from './schemas/contract.js';

const t = initProviderContract<CIProvider>();

/**
 * CI router - tRPC-like contract for CI providers
 * This router defines all available procedures with their input/output schemas and metadata
 */
export const ciRouter = t.router({
  fetchPR: t.procedure
    .input(FetchPRInputSchema)
    .output(PRInfoSchema)
    .meta({
      title: 'Fetch PR information',
      description: 'Fetch pull request information including status, reviewers, and merge checks',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.fetchPR(input);
    }),

  fetchCheckStatus: t.procedure
    .input(FetchCheckStatusInputSchema)
    .output(z.array(CheckStatusSchema))
    .meta({
      title: 'Fetch check status with annotations',
      description: 'Fetch CI check statuses for a PR or branch, including annotations and failure details',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.fetchCheckStatus(input);
    }),

  fetchComments: t.procedure
    .input(FetchCommentsInputSchema)
    .output(z.array(CommentSchema))
    .meta({
      title: 'Fetch PR comments and reactions',
      description: 'Fetch all comments for a PR including file comments, reactions, and thread information',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.fetchComments(input);
    })
});

