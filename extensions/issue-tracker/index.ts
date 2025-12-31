import { z } from 'zod';
import { publicProcedure, defineExtension } from '@barducks/sdk';
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

export default defineExtension((ext) => {
  return {
    api: {
      fetchIssue: publicProcedure
        .title('Fetch issue information')
        .description('Fetch issue information by ID or URL')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchIssueInputSchema)
        .return(IssueSchema)
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.fetchIssue(input);
        }),

      fetchComments: publicProcedure
        .title('Fetch issue comments')
        .description('Fetch all comments for an issue including reactions')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchCommentsInputSchema)
        .return(z.array(CommentSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.fetchComments(input);
        }),

      fetchPRs: publicProcedure
        .title('Fetch related pull requests')
        .description('Fetch related pull requests or branches for an issue')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(FetchPRsInputSchema)
        .return(z.array(PRReferenceSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.fetchPRs(input);
        }),

      downloadResources: publicProcedure
        .title('Download issue resources')
        .description('Download issue resources to .cache/issues folder')
        .meta({ idempotent: false, timeoutMs: 60_000 })
        .input(DownloadResourcesInputSchema)
        .return(DownloadResourcesResultSchema)
        .mutation(async (input) => {
          const provider = (ext as any).provider;
          return provider.downloadResources(input);
        }),
    },

    contracts: {
      issueTracker: {
        fetchIssue: publicProcedure
          .title('Fetch issue information')
          .description('Fetch issue information by ID or URL')
          .input(FetchIssueInputSchema)
          .return(IssueSchema)
          .contract(),

        fetchComments: publicProcedure
          .title('Fetch issue comments')
          .description('Fetch all comments for an issue including reactions')
          .input(FetchCommentsInputSchema)
          .return(z.array(CommentSchema))
          .contract(),

        fetchPRs: publicProcedure
          .title('Fetch related pull requests')
          .description('Fetch related pull requests or branches for an issue')
          .input(FetchPRsInputSchema)
          .return(z.array(PRReferenceSchema))
          .contract(),

        downloadResources: publicProcedure
          .title('Download issue resources')
          .description('Download issue resources to .cache/issues folder')
          .input(DownloadResourcesInputSchema)
          .return(DownloadResourcesResultSchema)
          .contract(),
      },
    },
  };
});
