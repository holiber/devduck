import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { publicProcedure, defineExtension } from '@barducks/sdk';
import {
  GetMessageInputSchema,
  SearchMessagesInputSchema,
  DownloadAttachmentInputSchema,
  ListUnreadInputSchema,
  MessageSchema
} from './schemas/contract.js';

export default defineExtension((ext) => {
  return {
    api: {
      getMessage: publicProcedure
        .title('Get a message by ID')
        .description('Fetch a single email message (including bodies when supported)')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(GetMessageInputSchema)
        .return(MessageSchema)
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.getMessage(input);
        }),

      searchMessages: publicProcedure
        .title('Search messages')
        .description('Search for messages with filters like query/from/participant and date ranges')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(SearchMessagesInputSchema)
        .return(z.array(MessageSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.searchMessages(input);
        }),

      downloadAttachment: publicProcedure
        .title('Download an attachment')
        .description('Download attachment content for a given message')
        .meta({ idempotent: true, timeoutMs: 20_000 })
        .input(DownloadAttachmentInputSchema)
        .return(z.instanceof(Buffer))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.downloadAttachment(input);
        }),

      listUnreadMessages: publicProcedure
        .title('List unread messages')
        .description('List unread messages since a timestamp (default: last 7 days)')
        .meta({ idempotent: true, timeoutMs: 10_000 })
        .input(ListUnreadInputSchema)
        .return(z.array(MessageSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.listUnreadMessages(input);
        }),
    },

    contracts: {
      email: {
        getMessage: publicProcedure
          .title('Get a message by ID')
          .description('Fetch a single email message (including bodies when supported)')
          .input(GetMessageInputSchema)
          .return(MessageSchema)
          .contract(),

        searchMessages: publicProcedure
          .title('Search messages')
          .description('Search for messages with filters like query/from/participant and date ranges')
          .input(SearchMessagesInputSchema)
          .return(z.array(MessageSchema))
          .contract(),

        downloadAttachment: publicProcedure
          .title('Download an attachment')
          .description('Download attachment content for a given message')
          .input(DownloadAttachmentInputSchema)
          .return(z.instanceof(Buffer))
          .contract(),

        listUnreadMessages: publicProcedure
          .title('List unread messages')
          .description('List unread messages since a timestamp (default: last 7 days)')
          .input(ListUnreadInputSchema)
          .return(z.array(MessageSchema))
          .contract(),
      },
    },
  };
});
