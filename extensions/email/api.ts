#!/usr/bin/env node

/**
 * Email module API - tRPC-like router definition
 * This is the source of truth for email module procedures
 */

import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { initProviderContract } from '@barducks/sdk';
import type { EmailProvider } from './schemas/contract.js';
import {
  DownloadAttachmentInputSchema,
  GetMessageInputSchema,
  ListUnreadInputSchema,
  MessageSchema,
  SearchMessagesInputSchema
} from './schemas/contract.js';

const t = initProviderContract<EmailProvider>();

/**
 * Email router - tRPC-like contract for email providers
 * This router defines all available procedures with their input/output schemas and metadata
 */
export const emailRouter = t.router({
  getMessage: t.procedure
    .input(GetMessageInputSchema)
    .output(MessageSchema)
    .meta({
      title: 'Get a message by ID',
      description: 'Fetch a single email message (including bodies when supported)',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.getMessage(input);
    }),

  searchMessages: t.procedure
    .input(SearchMessagesInputSchema)
    .output(z.array(MessageSchema))
    .meta({
      title: 'Search messages',
      description: 'Search for messages with filters like query/from/participant and date ranges',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.searchMessages(input);
    }),

  downloadAttachment: t.procedure
    .input(DownloadAttachmentInputSchema)
    .output(z.instanceof(Buffer))
    .meta({
      title: 'Download an attachment',
      description: 'Download attachment content for a given message',
      idempotent: true,
      timeoutMs: 20_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.downloadAttachment(input);
    }),

  listUnreadMessages: t.procedure
    .input(ListUnreadInputSchema)
    .output(z.array(MessageSchema))
    .meta({
      title: 'List unread messages',
      description: 'List unread messages since a timestamp (default: last 7 days)',
      idempotent: true,
      timeoutMs: 10_000
    })
    .handler(async ({ input, ctx }) => {
      return ctx.provider.listUnreadMessages(input);
    })
});

