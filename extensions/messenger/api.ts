import { z } from 'zod';

import { defineExtention, publicProcedure } from '@barducks/sdk';

import type { MessengerProvider } from './schemas/contract.js';
import {
  ListChatsInputSchema,
  GetChatHistoryInputSchema,
  DownloadFileInputSchema,
  ChatSchema,
  ChatMessageSchema,
  DownloadFileResultSchema
} from './schemas/contract.js';

export default defineExtention((ext: { messenger: MessengerProvider }) => {
  return {
    api: {
      listChats: publicProcedure
        .title('List chats')
        .input(ListChatsInputSchema)
        .return(z.array(ChatSchema))
        .query((input) => ext.messenger.listChats(input)),

      getChatHistory: publicProcedure
        .title('Get chat history')
        .input(GetChatHistoryInputSchema)
        .return(z.array(ChatMessageSchema))
        .query((input) => ext.messenger.getChatHistory(input)),

      downloadFile: publicProcedure
        .title('Download a file')
        .input(DownloadFileInputSchema)
        .return(DownloadFileResultSchema)
        .query((input) => ext.messenger.downloadFile(input))
    },

    contracts: {
      messenger: {
        listChats: publicProcedure.title('List chats').input(ListChatsInputSchema).return(z.array(ChatSchema)),
        getChatHistory: publicProcedure
          .title('Get chat history')
          .input(GetChatHistoryInputSchema)
          .return(z.array(ChatMessageSchema)),
        downloadFile: publicProcedure.title('Download a file').input(DownloadFileInputSchema).return(DownloadFileResultSchema)
      }
    }
  };
});

