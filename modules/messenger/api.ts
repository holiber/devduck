#!/usr/bin/env node

/**
 * Messenger module API - tRPC-like router definition
 * This is the source of truth for messenger module procedures
 */

import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { initProviderContract } from '../../scripts/lib/provider-router.js';
import type { MessengerProvider } from './schemas/contract.js';
import { GetChatHistoryInputSchema, DownloadFileInputSchema, ChatMessageSchema } from './schemas/contract.js';

const t = initProviderContract<MessengerProvider>();

/**
 * Messenger router - tRPC-like contract for messenger providers
 * This router defines all available procedures with their input/output schemas and metadata
 */
export const messengerRouter = t.router({
  getChatHistory: t.procedure
    .input(GetChatHistoryInputSchema)
    .output(z.array(ChatMessageSchema))
    .meta({
      title: 'Get chat history',
      description: 'Fetch chat history messages for a chat',
      idempotent: true,
      timeoutMs: 15_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.getChatHistory(input);
    }),

  downloadFile: t.procedure
    .input(DownloadFileInputSchema)
    .output(z.instanceof(Buffer))
    .meta({
      title: 'Download a file',
      description: 'Download a file by ID (providers should cache when possible)',
      idempotent: true,
      timeoutMs: 60_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.downloadFile(input);
    })
});

