import { z } from 'zod';

/**
 * Provider protocol version for this contract.
 * Bump only on breaking changes.
 */
export const EMAIL_PROVIDER_PROTOCOL_VERSION = '1.0.0' as const;

export const TimestampSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid ISO timestamp' });

export const IdSchema = z.string().min(1);

export const EmailAddressSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional()
});

export const AttachmentSchema = z.object({
  id: IdSchema,
  filename: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional()
});

export const ThreadSchema = z.object({
  id: IdSchema,
  messageIds: z.array(IdSchema).default([])
});

export const MessageSchema = z.object({
  id: IdSchema,
  threadId: IdSchema.optional(),

  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema).default([]),
  cc: z.array(EmailAddressSchema).optional(),
  bcc: z.array(EmailAddressSchema).optional(),

  subject: z.string().default(''),
  date: TimestampSchema,
  snippet: z.string().optional(),

  text: z.string().optional(),
  html: z.string().optional(),

  attachments: z.array(AttachmentSchema).default([]),
  isRead: z.boolean().default(false)
});

export const ErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'TEMPORARY_UNAVAILABLE',
  'UNKNOWN'
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// Tool names type
export type EmailToolName = 'getMessage' | 'searchMessages' | 'downloadAttachment' | 'listUnreadMessages';

export const EmailToolNameSchema = z.enum([
  'getMessage',
  'searchMessages',
  'downloadAttachment',
  'listUnreadMessages'
]);

// Tool inputs
export const GetMessageInputSchema = z.object({
  messageId: IdSchema
});

export const SearchMessagesInputSchema = z.object({
  query: z.string().optional(),
  from: z.string().email().optional(),
  participant: z.string().email().optional(),
  after: TimestampSchema.optional(),
  before: TimestampSchema.optional(),
  limit: z.number().int().positive().max(500).optional()
});

export const DownloadAttachmentInputSchema = z.object({
  messageId: IdSchema,
  attachmentId: IdSchema
});

export const ListUnreadInputSchema = z.object({
  since: TimestampSchema.optional(),
  limit: z.number().int().positive().max(500).optional()
});

export type GetMessageInput = z.infer<typeof GetMessageInputSchema>;
export type SearchMessagesInput = z.infer<typeof SearchMessagesInputSchema>;
export type DownloadAttachmentInput = z.infer<typeof DownloadAttachmentInputSchema>;
export type ListUnreadInput = z.infer<typeof ListUnreadInputSchema>;

export type EmailAddress = z.infer<typeof EmailAddressSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type Message = z.infer<typeof MessageSchema>;

/**
 * Mapping of tool names to their input schemas
 * This is automatically used to generate CLI commands (when using routers)
 */
export const EmailToolInputSchemas: Record<EmailToolName, z.ZodObject<any>> = {
  getMessage: GetMessageInputSchema,
  searchMessages: SearchMessagesInputSchema,
  downloadAttachment: DownloadAttachmentInputSchema,
  listUnreadMessages: ListUnreadInputSchema
};

/**
 * Descriptions for tools (used in CLI help)
 */
export const EmailToolDescriptions: Record<EmailToolName, string> = {
  getMessage: 'Get a message by ID',
  searchMessages: 'Search messages',
  downloadAttachment: 'Download an attachment',
  listUnreadMessages: 'List unread messages'
};

// Provider manifest (metadata)
export const EmailProviderManifestSchema = z
  .object({
    type: z.literal('email'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    protocolVersion: z.literal(EMAIL_PROVIDER_PROTOCOL_VERSION),
    tools: z.array(EmailToolNameSchema),
    events: z
      .object({
        publish: z.array(z.string()).default([]),
        subscribe: z.array(z.string()).default([])
      })
      .default({ publish: [], subscribe: [] }),
    auth: z
      .object({
        type: z.enum(['none', 'oauth2', 'apiKey']).default('none'),
        requiredTokens: z.array(z.string()).default([])
      })
      .default({ type: 'none', requiredTokens: [] }),
    capabilities: z.array(z.string()).default([])
  })
  .passthrough();

export type EmailProviderManifest = z.infer<typeof EmailProviderManifestSchema>;

/**
 * Email provider interface
 */
export interface EmailProvider {
  name: string;
  version: string;
  manifest: EmailProviderManifest;
  getMessage(input: GetMessageInput): Promise<Message>;
  searchMessages(input: SearchMessagesInput): Promise<Message[]>;
  downloadAttachment(input: DownloadAttachmentInput): Promise<Buffer>;
  listUnreadMessages(input: ListUnreadInput): Promise<Message[]>;
};

