import { z } from 'zod';

import { defineExtension, publicProcedure } from '@barducks/sdk';

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

export default defineExtension((ext: { 'issue-tracker': IssueTrackerProvider }) => {
  return {
    api: {
      fetchIssue: publicProcedure
        .title('Fetch issue information')
        .input(FetchIssueInputSchema)
        .return(IssueSchema)
        .query((input) => ext['issue-tracker'].fetchIssue(input)),

      fetchComments: publicProcedure
        .title('Fetch issue comments')
        .input(FetchCommentsInputSchema)
        .return(z.array(CommentSchema))
        .query((input) => ext['issue-tracker'].fetchComments(input)),

      fetchPRs: publicProcedure
        .title('Fetch related pull requests')
        .input(FetchPRsInputSchema)
        .return(z.array(PRReferenceSchema))
        .query((input) => ext['issue-tracker'].fetchPRs(input)),

      downloadResources: publicProcedure
        .title('Download issue resources')
        .input(DownloadResourcesInputSchema)
        .return(DownloadResourcesResultSchema)
        .query((input) => ext['issue-tracker'].downloadResources(input))
    },

    contracts: {
      'issue-tracker': {
        fetchIssue: publicProcedure.title('Fetch issue information').input(FetchIssueInputSchema).return(IssueSchema),
        fetchComments: publicProcedure
          .title('Fetch issue comments')
          .input(FetchCommentsInputSchema)
          .return(z.array(CommentSchema)),
        fetchPRs: publicProcedure.title('Fetch related pull requests').input(FetchPRsInputSchema).return(z.array(PRReferenceSchema)),
        downloadResources: publicProcedure
          .title('Download issue resources')
          .input(DownloadResourcesInputSchema)
          .return(DownloadResourcesResultSchema)
      }
    }
  };
});

