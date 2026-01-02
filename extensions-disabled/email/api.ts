import { z } from 'zod';
import { Buffer } from 'node:buffer';

import { defineExtention, publicProcedure } from '@barducks/sdk';

import type { EmailProvider } from './schemas/contract.js';
import {
  DownloadAttachmentInputSchema,
  GetMessageInputSchema,
  ListUnreadInputSchema,
  MessageSchema,
  SearchMessagesInputSchema
} from './schemas/contract.js';

export default defineExtention((ext: { email: EmailProvider }) => {
  return {
    api: {
      getMessage: publicProcedure
        .title('Get a message by ID')
        .input(GetMessageInputSchema)
        .return(MessageSchema)
        .query((input) => ext.email.getMessage(input)),

      searchMessages: publicProcedure
        .title('Search messages')
        .input(SearchMessagesInputSchema)
        .return(z.array(MessageSchema))
        .query((input) => ext.email.searchMessages(input)),

      downloadAttachment: publicProcedure
        .title('Download an attachment')
        .input(DownloadAttachmentInputSchema)
        .return(z.instanceof(Buffer))
        .query((input) => ext.email.downloadAttachment(input)),

      listUnreadMessages: publicProcedure
        .title('List unread messages')
        .input(ListUnreadInputSchema)
        .return(z.array(MessageSchema))
        .query((input) => ext.email.listUnreadMessages(input))
    },

    contracts: {
      email: {
        getMessage: publicProcedure.title('Get a message by ID').input(GetMessageInputSchema).return(MessageSchema),
        searchMessages: publicProcedure
          .title('Search messages')
          .input(SearchMessagesInputSchema)
          .return(z.array(MessageSchema)),
        downloadAttachment: publicProcedure
          .title('Download an attachment')
          .input(DownloadAttachmentInputSchema)
          .return(z.instanceof(Buffer)),
        listUnreadMessages: publicProcedure
          .title('List unread messages')
          .input(ListUnreadInputSchema)
          .return(z.array(MessageSchema))
      }
    }
  };
});

