import { z } from 'zod';
import { defineTools, defineVendorTools, tool } from '../../src/lib/tool-spec.js';
import {
  FetchPRInputSchema,
  FetchCheckStatusInputSchema,
  FetchCommentsInputSchema,
  FetchReviewInputSchema,
  PRInfoSchema,
  CheckStatusSchema,
  CommentSchema
} from './schemas/contract.js';

export const ciTools = defineTools({
  fetchPR: tool({
    input: FetchPRInputSchema,
    output: PRInfoSchema,
    meta: {
      title: 'Fetch PR information',
      description: 'Fetch pull request information including status, reviewers, and merge checks',
      idempotent: true,
      timeoutMs: 10_000,
      examples: [{ command: 'api-cli ci.fetchPR --prId 123' }]
    }
  }),

  fetchCheckStatus: tool({
    input: FetchCheckStatusInputSchema,
    output: z.array(CheckStatusSchema),
    meta: {
      title: 'Fetch check status with annotations',
      description: 'Fetch CI check statuses for a PR or branch, including annotations and failure details',
      idempotent: true,
      timeoutMs: 10_000,
      examples: [{ command: 'api-cli ci.fetchCheckStatus --branch main' }]
    }
  }),

  fetchComments: tool({
    input: FetchCommentsInputSchema,
    output: z.array(CommentSchema),
    meta: {
      title: 'Fetch PR comments and reactions',
      description: 'Fetch all comments for a PR including file comments, reactions, and thread information',
      idempotent: true,
      timeoutMs: 10_000,
      examples: [{ command: 'api-cli ci.fetchComments --prId 123' }]
    }
  })
} as const);

export const ciVendorTools = defineVendorTools({
  arcanum: defineTools({
    fetchReview: tool({
      input: FetchReviewInputSchema,
      output: PRInfoSchema,
      meta: {
        title: 'Fetch Arcanum review information',
        description: 'Fetch Arcanum review information by review ID or URL',
        idempotent: true,
        timeoutMs: 10_000,
        examples: [{ command: 'api-cli ci.vendor.arcanum.fetchReview --reviewId 10930804' }]
      }
    })
  })
} as const);

export const ciSpec = {
  name: 'ci',
  description: 'CI module with provider system for continuous integration systems',
  requiresProvider: true,
  providerType: 'ci',
  tools: ciTools,
  vendorTools: ciVendorTools
} as const;

export default ciSpec;

