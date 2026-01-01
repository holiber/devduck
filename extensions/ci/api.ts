import { z } from 'zod';

import { defineExtention, publicProcedure } from '@barducks/sdk';

import type { CIProvider } from './schemas/contract.js';
import {
  FetchPRInputSchema,
  FetchCheckStatusInputSchema,
  FetchCommentsInputSchema,
  FetchReviewInputSchema,
  PRInfoSchema,
  CheckStatusSchema,
  CommentSchema
} from './schemas/contract.js';

export default defineExtention((ext: { ci: CIProvider }) => {
  return {
    api: {
      fetchPR: publicProcedure
        .title('Fetch PR information')
        .input(FetchPRInputSchema)
        .return(PRInfoSchema)
        .query((input) => ext.ci.fetchPR(input)),

      fetchCheckStatus: publicProcedure
        .title('Fetch check status with annotations')
        .input(FetchCheckStatusInputSchema)
        .return(z.array(CheckStatusSchema))
        .query((input) => ext.ci.fetchCheckStatus(input)),

      fetchComments: publicProcedure
        .title('Fetch PR comments and reactions')
        .input(FetchCommentsInputSchema)
        .return(z.array(CommentSchema))
        .query((input) => ext.ci.fetchComments(input)),

      'vendor.arcanum.fetchReview': publicProcedure
        .title('Fetch Arcanum review information')
        .input(FetchReviewInputSchema)
        .return(PRInfoSchema)
        .query((input) => {
          const vendor = (ext.ci as any).vendor as { arcanum?: { fetchReview?: (i: unknown) => Promise<unknown> } } | undefined;
          const fn = vendor?.arcanum?.fetchReview;
          if (typeof fn !== 'function') {
            throw new Error("CI provider does not implement vendor tool 'vendor.arcanum.fetchReview'");
          }
          return fn(input);
        })
    },

    contracts: {
      ci: {
        fetchPR: publicProcedure.title('Fetch PR information').input(FetchPRInputSchema).return(PRInfoSchema),
        fetchCheckStatus: publicProcedure
          .title('Fetch check status with annotations')
          .input(FetchCheckStatusInputSchema)
          .return(z.array(CheckStatusSchema)),
        fetchComments: publicProcedure
          .title('Fetch PR comments and reactions')
          .input(FetchCommentsInputSchema)
          .return(z.array(CommentSchema)),
        vendor: {
          arcanum: {
            fetchReview: publicProcedure.title('Fetch Arcanum review information').input(FetchReviewInputSchema).return(PRInfoSchema)
          }
        }
      }
    }
  };
});

