import { z } from 'zod';
import { publicProcedure, defineExtension } from '@barducks/sdk';
import {
  FetchPRInputSchema,
  FetchCheckStatusInputSchema,
  FetchCommentsInputSchema,
  FetchReviewInputSchema,
  PRInfoSchema,
  CheckStatusSchema,
  CommentSchema
} from './schemas/contract.js';

export default defineExtension((ext) => {
  return {
    api: {
      fetchPR: publicProcedure
        .title('Fetch PR information')
        .description('Fetch pull request information including status, reviewers, and merge checks')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchPRInputSchema)
        .return(PRInfoSchema)
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.fetchPR(input);
        }),

      fetchCheckStatus: publicProcedure
        .title('Fetch check status with annotations')
        .description('Fetch CI check statuses for a PR or branch, including annotations and failure details')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchCheckStatusInputSchema)
        .return(z.array(CheckStatusSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.fetchCheckStatus(input);
        }),

      fetchComments: publicProcedure
        .title('Fetch PR comments and reactions')
        .description('Fetch all comments for a PR including file comments, reactions, and thread information')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchCommentsInputSchema)
        .return(z.array(CommentSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.fetchComments(input);
        }),

      // Vendor-specific: Arcanum
      'vendor.arcanum.fetchReview': publicProcedure
        .title('Fetch Arcanum review information')
        .description('Fetch Arcanum review information by review ID or URL')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchReviewInputSchema)
        .return(PRInfoSchema)
        .query(async (input) => {
          const provider = (ext as any).provider;
          if (!provider.vendor?.arcanum?.fetchReview) {
            throw new Error('Provider does not implement vendor.arcanum.fetchReview');
          }
          return provider.vendor.arcanum.fetchReview(input);
        }),
    },

    contracts: {
      ci: {
        fetchPR: publicProcedure
          .title('Fetch PR information')
          .description('Fetch pull request information including status, reviewers, and merge checks')
          .input(FetchPRInputSchema)
          .return(PRInfoSchema)
          .contract(),

        fetchCheckStatus: publicProcedure
          .title('Fetch check status with annotations')
          .description('Fetch CI check statuses for a PR or branch, including annotations and failure details')
          .input(FetchCheckStatusInputSchema)
          .return(z.array(CheckStatusSchema))
          .contract(),

        fetchComments: publicProcedure
          .title('Fetch PR comments and reactions')
          .description('Fetch all comments for a PR including file comments, reactions, and thread information')
          .input(FetchCommentsInputSchema)
          .return(z.array(CommentSchema))
          .contract(),
      },

      'ci.vendor.arcanum': {
        fetchReview: publicProcedure
          .title('Fetch Arcanum review information')
          .description('Fetch Arcanum review information by review ID or URL')
          .input(FetchReviewInputSchema)
          .return(PRInfoSchema)
          .contract(),
      },
    },
  };
});
