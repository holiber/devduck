#!/usr/bin/env node

/**
 * Issue Tracker module API - tRPC-like router definition
 * This is the source of truth for Issue Tracker module procedures
 */

import { z } from 'zod';
import { initProviderContract } from '../../scripts/lib/provider-router.js';
import type { IssueTrackerProvider } from './schemas/contract.js';
import {
  FetchIssueInputSchema,
  FetchCommentsInputSchema,
  FetchPRsInputSchema,
  DownloadResourcesInputSchema,
  IssueSchema,
  CommentSchema,
  PRReferenceSchema,
  DownloadResourcesResultSchema
} from './schemas/contract.js';

const t = initProviderContract<IssueTrackerProvider>();

/**
 * Issue Tracker router - tRPC-like contract for Issue Tracker providers
 * This router defines all available procedures with their input/output schemas and metadata
 */
export const issueTrackerRouter = t.router({
  fetchIssue: t.procedure
    .input(FetchIssueInputSchema)
    .output(IssueSchema)
    .meta({
      title: 'Fetch issue information',
      description: 'Fetch issue information by ID or URL',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.fetchIssue(input);
    }),

  fetchComments: t.procedure
    .input(FetchCommentsInputSchema)
    .output(z.array(CommentSchema))
    .meta({
      title: 'Fetch issue comments',
      description: 'Fetch all comments for an issue including reactions',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.fetchComments(input);
    }),

  fetchPRs: t.procedure
    .input(FetchPRsInputSchema)
    .output(z.array(PRReferenceSchema))
    .meta({
      title: 'Fetch related pull requests',
      description: 'Fetch related pull requests or branches for an issue',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.fetchPRs(input);
    }),

  downloadResources: t.procedure
    .input(DownloadResourcesInputSchema)
    .output(DownloadResourcesResultSchema)
    .meta({
      title: 'Download issue resources',
      description: 'Download issue resources to .cache/issues folder',
      idempotent: false,
      timeoutMs: 60_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.downloadResources(input);
    })
});

