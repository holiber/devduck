import { z } from 'zod';
import { publicProcedure, defineExtension } from '@barducks/sdk';
import {
  ListChatsInputSchema,
  GetChatHistoryInputSchema,
  DownloadFileInputSchema,
  ChatSchema,
  ChatMessageSchema,
  DownloadFileResultSchema
} from './schemas/contract.js';

export default defineExtension((ext) => {
  return {
    api: {
      listChats: publicProcedure
        .title('List chats')
        .description('List chats available for the current account')
        .meta({ idempotent: true, timeoutMs: 15_000 })
        .input(ListChatsInputSchema)
        .return(z.array(ChatSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.listChats(input);
        }),

      getChatHistory: publicProcedure
        .title('Get chat history')
        .description('Fetch chat history messages for a chat')
        .meta({ idempotent: true, timeoutMs: 15_000 })
        .input(GetChatHistoryInputSchema)
        .return(z.array(ChatMessageSchema))
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.getChatHistory(input);
        }),

      downloadFile: publicProcedure
        .title('Download a file')
        .description('Download a file by ID and return a cached file descriptor')
        .meta({ idempotent: true, timeoutMs: 60_000 })
        .input(DownloadFileInputSchema)
        .return(DownloadFileResultSchema)
        .query(async (input) => {
          const provider = (ext as any).provider;
          return provider.downloadFile(input);
        }),
    },

    contracts: {
      messenger: {
        listChats: publicProcedure
          .title('List chats')
          .description('List chats available for the current account')
          .input(ListChatsInputSchema)
          .return(z.array(ChatSchema))
          .contract(),

        getChatHistory: publicProcedure
          .title('Get chat history')
          .description('Fetch chat history messages for a chat')
          .input(GetChatHistoryInputSchema)
          .return(z.array(ChatMessageSchema))
          .contract(),

        downloadFile: publicProcedure
          .title('Download a file')
          .description('Download a file by ID and return a cached file descriptor')
          .input(DownloadFileInputSchema)
          .return(DownloadFileResultSchema)
          .contract(),
      },
    },
  };
});
