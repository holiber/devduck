import { z } from 'zod';

/**
 * Provider protocol version for this contract.
 * Bump only on breaking changes.
 */
export const MESSENGER_PROVIDER_PROTOCOL_VERSION = '1.0.0' as const;

export const TimestampSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid ISO timestamp' });

export const IdSchema = z.string().min(1);

export const ErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'TEMPORARY_UNAVAILABLE',
  'UNKNOWN'
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ParticipantSchema = z
  .object({
    id: IdSchema,
    username: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    avatarUrl: z.string().url().optional()
  })
  .passthrough();
export type Participant = z.infer<typeof ParticipantSchema>;

export const FileRefSchema = z
  .object({
    id: IdSchema,
    /**
     * Provider-specific file identifier (opaque).
     * Example for TDLib: "tdlib:123456".
     */
    providerFileId: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    sizeBytes: z.number().int().nonnegative().optional()
  })
  .passthrough();
export type FileRef = z.infer<typeof FileRefSchema>;

export const ChatSchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1).optional(),
    type: z.string().min(1).optional(), // provider-specific (private/group/channel/...)
    participantsCount: z.number().int().nonnegative().optional(),
    raw: z.unknown().optional()
  })
  .passthrough();
export type Chat = z.infer<typeof ChatSchema>;

export const ChatMessageSchema = z
  .object({
    id: IdSchema,
    chatId: IdSchema,
    date: TimestampSchema,
    from: ParticipantSchema.optional(),
    text: z.string().optional(),
    files: z.array(FileRefSchema).default([]),
    raw: z.unknown().optional()
  })
  .passthrough();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Tool names
export const MessengerToolNameSchema = z.enum(['listChats', 'getChatHistory', 'downloadFile']);
export type MessengerToolName = z.infer<typeof MessengerToolNameSchema>;

export const ListChatsInputSchema = z.object({
  limit: z.number().int().positive().max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
  query: z.string().min(1).optional()
});
export type ListChatsInput = z.infer<typeof ListChatsInputSchema>;

// Tool input schemas
export const GetChatHistoryInputSchema = z.object({
  chatId: IdSchema,
  limit: z.number().int().positive().max(500).default(50),
  beforeMessageId: IdSchema.optional(),
  since: TimestampSchema.optional()
});
export type GetChatHistoryInput = z.infer<typeof GetChatHistoryInputSchema>;

export const DownloadFileInputSchema = z.object({
  fileId: IdSchema,
  /**
   * When true, providers should try to return a cached value if available.
   * Providers may still revalidate/refresh depending on their caching policy.
   */
  preferCache: z.boolean().default(true)
});
export type DownloadFileInput = z.infer<typeof DownloadFileInputSchema>;

export const DownloadFileResultSchema = z
  .object({
    fileId: IdSchema,
    cached: z.boolean(),
    /**
     * File path on disk. Providers are expected to store files under `.cache/devduck/messenger/`.
     * May be in a temporary location if caching is explicitly disabled.
     */
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().min(1).optional(),
    sha256: z.string().min(1).optional()
  })
  .passthrough();
export type DownloadFileResult = z.infer<typeof DownloadFileResultSchema>;

/**
 * Mapping of tool names to their input schemas
 * This is automatically used to generate CLI commands.
 */
export const MessengerToolInputSchemas: Record<MessengerToolName, z.ZodObject<any>> = {
  listChats: ListChatsInputSchema,
  getChatHistory: GetChatHistoryInputSchema,
  downloadFile: DownloadFileInputSchema
};

/**
 * Descriptions for tools (used in CLI help)
 */
export const MessengerToolDescriptions: Record<MessengerToolName, string> = {
  listChats: 'List chats',
  getChatHistory: 'Get chat history by chat ID',
  downloadFile: 'Download a file by file ID'
};

// Provider manifest (metadata)
export const MessengerProviderManifestSchema = z
  .object({
    type: z.literal('messenger'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    protocolVersion: z.literal(MESSENGER_PROVIDER_PROTOCOL_VERSION),
    tools: z.array(MessengerToolNameSchema),
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

export type MessengerProviderManifest = z.infer<typeof MessengerProviderManifestSchema>;

/**
 * Messenger provider interface (validated at registration time).
 *
 * Note: Zod cannot fully validate function signatures without executing them.
 * We validate that required methods exist and that metadata matches the contract.
 */
export const MessengerProviderSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  manifest: MessengerProviderManifestSchema,

  listChats: z.function(),
  getChatHistory: z.function(),
  downloadFile: z.function()
});

export type MessengerProvider = z.infer<typeof MessengerProviderSchema> & {
  listChats(input: ListChatsInput): Promise<Chat[]>;
  getChatHistory(input: GetChatHistoryInput): Promise<ChatMessage[]>;
  downloadFile(input: DownloadFileInput): Promise<DownloadFileResult>;
};

