import { z } from 'zod';

/**
 * Provider protocol version for this contract.
 * Bump only on breaking changes.
 */
export const ISSUE_TRACKER_PROVIDER_PROTOCOL_VERSION = '1.0.0' as const;

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

// Comment reaction schema (reused from CI module pattern)
export const CommentReactionSchema = z.object({
  type: z.string().min(1), // e.g., 'THUMBS_UP', 'HEART', etc.
  count: z.number().int().nonnegative().default(0),
  users: z.array(z.string()).default([]) // user logins
});
export type CommentReaction = z.infer<typeof CommentReactionSchema>;

// Comment schema
export const CommentSchema = z.object({
  id: IdSchema,
  body: z.string().default(''),
  author: z.object({
    id: IdSchema.optional(),
    login: z.string().min(1),
    name: z.string().optional(),
    avatarUrl: z.string().url().optional()
  }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema.optional(),
  reactions: z.array(CommentReactionSchema).default([]),
  url: z.string().url().optional()
});
export type Comment = z.infer<typeof CommentSchema>;

// PR reference schema (simpler than CI's PRInfo, just a reference)
export const PRReferenceSchema = z.object({
  id: IdSchema,
  number: z.number().int().positive().optional(),
  title: z.string().default(''),
  url: z.string().url().optional(),
  branch: z.string().optional() // Branch name if available
});
export type PRReference = z.infer<typeof PRReferenceSchema>;

// Issue schema
export const IssueSchema = z.object({
  id: IdSchema,
  key: z.string().optional(), // Issue key (e.g., "CRM-47297", "#20")
  title: z.string().default(''),
  description: z.string().default(''),
  status: z.string().optional(),
  state: z.string().optional(), // Provider-specific state
  url: z.string().url().optional(),
  author: z
    .object({
      id: IdSchema.optional(),
      login: z.string().min(1),
      name: z.string().optional(),
      avatarUrl: z.string().url().optional()
    })
    .optional(),
  assignee: z
    .object({
      id: IdSchema.optional(),
      login: z.string().min(1),
      name: z.string().optional(),
      avatarUrl: z.string().url().optional()
    })
    .optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
  closedAt: TimestampSchema.optional(),
  labels: z
    .array(
      z.object({
        name: z.string().min(1),
        color: z.string().optional(), // Hex color code
        description: z.string().optional()
      })
    )
    .default([])
}).passthrough();
export type Issue = z.infer<typeof IssueSchema>;

// Resource metadata schema (for resources.json)
export const ResourceMetadataSchema = z.object({
  path: z.string().min(1), // Path to downloaded file in filesystem
  indexedAt: TimestampSchema, // When we indexed this resource
  lastUpdated: TimestampSchema.optional(), // When source was last updated
  type: z.enum(['json', 'wiki', 'ticket', 'attachment', 'url']),
  description: z.string().optional(), // Human-readable description
  size: z.number().int().nonnegative().optional(), // File size in bytes
  downloaded: z.boolean().default(false), // Whether file was actually downloaded
  distance: z.number().int().nonnegative().default(0), // Distance from root issue
  source: z.string().url(), // Original source URL
  ticketKey: z.string().optional(), // For ticket type resources
  error: z.string().optional(), // Error message if download failed
  httpStatus: z.number().int().positive().optional() // HTTP status code from download response
});
export type ResourceMetadata = z.infer<typeof ResourceMetadataSchema>;

// Download resources result schema
export const DownloadResourcesResultSchema = z.object({
  issueId: IdSchema,
  resourcesPath: z.string(), // Path to resources directory
  resourcesJsonPath: z.string(), // Path to resources.json file
  downloadedCount: z.number().int().nonnegative().default(0),
  trackedCount: z.number().int().nonnegative().default(0),
  errorCount: z.number().int().nonnegative().default(0)
});
export type DownloadResourcesResult = z.infer<typeof DownloadResourcesResultSchema>;

// Tool names
export const IssueTrackerToolNameSchema = z.enum(['fetchIssue', 'fetchComments', 'fetchPRs', 'downloadResources']);
export type IssueTrackerToolName = z.infer<typeof IssueTrackerToolNameSchema>;

// Tool input schemas
export const FetchIssueInputSchema = z.object({
  issueId: z.string().min(1).optional(),
  url: z.string().url().optional()
});
export type FetchIssueInput = z.infer<typeof FetchIssueInputSchema>;

export const FetchCommentsInputSchema = z.object({
  issueId: z.string().min(1)
});
export type FetchCommentsInput = z.infer<typeof FetchCommentsInputSchema>;

export const FetchPRsInputSchema = z.object({
  issueId: z.string().min(1)
});
export type FetchPRsInput = z.infer<typeof FetchPRsInputSchema>;

export const DownloadResourcesInputSchema = z.object({
  issueId: z.string().min(1),
  maxDistance: z.number().int().nonnegative().default(2) // Default: download distance <= 2
});
export type DownloadResourcesInput = z.infer<typeof DownloadResourcesInputSchema>;

/**
 * Mapping of tool names to their input schemas
 * This is automatically used to generate CLI commands
 */
export const IssueTrackerToolInputSchemas: Record<IssueTrackerToolName, z.ZodObject<any>> = {
  fetchIssue: FetchIssueInputSchema,
  fetchComments: FetchCommentsInputSchema,
  fetchPRs: FetchPRsInputSchema,
  downloadResources: DownloadResourcesInputSchema
};

/**
 * Descriptions for tools (used in CLI help)
 */
export const IssueTrackerToolDescriptions: Record<IssueTrackerToolName, string> = {
  fetchIssue: 'Fetch issue information by ID or URL',
  fetchComments: 'Fetch issue comments',
  fetchPRs: 'Fetch related pull requests or branches',
  downloadResources: 'Download issue resources to .cache/issues folder'
};

// Provider manifest (metadata)
export const IssueTrackerProviderManifestSchema = z
  .object({
    type: z.literal('issue-tracker'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    protocolVersion: z.literal(ISSUE_TRACKER_PROVIDER_PROTOCOL_VERSION),
    tools: z.array(IssueTrackerToolNameSchema),
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

export type IssueTrackerProviderManifest = z.infer<typeof IssueTrackerProviderManifestSchema>;

/**
 * Issue tracker provider interface (validated at registration time).
 *
 * Note: Zod cannot fully validate function signatures without executing them.
 * We validate that required methods exist and that metadata matches the contract.
 */
export const IssueTrackerProviderSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  manifest: IssueTrackerProviderManifestSchema,

  // Issue tracker provider methods
  fetchIssue: z.function(),
  fetchComments: z.function(),
  fetchPRs: z.function(),
  downloadResources: z.function()
});

export type IssueTrackerProvider = z.infer<typeof IssueTrackerProviderSchema> & {
  fetchIssue(input: FetchIssueInput): Promise<Issue>;
  fetchComments(input: FetchCommentsInput): Promise<Comment[]>;
  fetchPRs(input: FetchPRsInput): Promise<PRReference[]>;
  downloadResources(input: DownloadResourcesInput): Promise<DownloadResourcesResult>;
};

