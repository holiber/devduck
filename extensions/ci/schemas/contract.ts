import { z } from 'zod';

/**
 * Provider protocol version for this contract.
 * Bump only on breaking changes.
 */
export const CI_PROVIDER_PROTOCOL_VERSION = '1.0.0' as const;

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

// Reviewer schema
export const ReviewerSchema = z.object({
  id: IdSchema,
  login: z.string().min(1),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED']).optional()
});
export type Reviewer = z.infer<typeof ReviewerSchema>;

// Merge check status schema
export const MergeCheckStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'queued',
  'success',
  'failure',
  'cancelled',
  'skipped',
  'neutral',
  'action_required'
]);
export type MergeCheckStatus = z.infer<typeof MergeCheckStatusSchema>;

// Annotation schema for check status
export const AnnotationSchema = z.object({
  path: z.string().optional(),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  startColumn: z.number().int().nonnegative().optional(),
  endColumn: z.number().int().nonnegative().optional(),
  message: z.string().min(1),
  level: z.enum(['notice', 'warning', 'failure']).optional(),
  title: z.string().optional()
});
export type Annotation = z.infer<typeof AnnotationSchema>;

// Check status schema
export const CheckStatusSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  status: MergeCheckStatusSchema,
  conclusion: MergeCheckStatusSchema.nullable().optional(),
  url: z.string().url().optional(),
  annotations: z.array(AnnotationSchema).default([]),
  annotationsCount: z.number().int().nonnegative().optional(),
  annotationsUrl: z.string().url().optional(),
  failureReason: z.string().optional(),
  failureTitle: z.string().optional(),
  failureDetails: z.array(z.string()).optional(),
  output: z
    .object({
      summary: z.string().optional(),
      text: z.string().optional(),
      title: z.string().optional()
    })
    .optional()
});
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

// PR info schema
export const PRInfoSchema = z.object({
  id: IdSchema,
  number: z.number().int().positive().optional(),
  title: z.string().default(''),
  status: z.enum(['open', 'closed', 'merged', 'draft']).optional(),
  state: z.string().optional(), // Provider-specific state
  commentCount: z.number().int().nonnegative().default(0),
  mergeCheckStatus: z
    .object({
      canMerge: z.boolean().default(false),
      checksTotal: z.number().int().nonnegative().default(0),
      checksPassed: z.number().int().nonnegative().default(0),
      checksFailed: z.number().int().nonnegative().default(0),
      checksPending: z.number().int().nonnegative().default(0)
    })
    .optional(),
  reviewers: z.array(ReviewerSchema).default([]),
  url: z.string().url().optional(),
  branch: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      head: z.string().optional(),
      base: z.string().optional()
    })
    .optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional()
});
export type PRInfo = z.infer<typeof PRInfoSchema>;

// Comment reaction schema
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
  path: z.string().optional(), // File path for file comments
  line: z.number().int().positive().optional(), // Line number for file comments
  reactions: z.array(CommentReactionSchema).default([]),
  isResolved: z.boolean().default(false).optional(),
  url: z.string().url().optional()
});
export type Comment = z.infer<typeof CommentSchema>;

// Tool input schemas
export const FetchPRInputSchema = z.object({
  prId: z.union([IdSchema, z.number().int().positive()]).optional(),
  branch: z.string().min(1).optional(),
  owner: z.string().min(1).optional(), // For GitHub: repo owner
  repo: z.string().min(1).optional() // For GitHub: repo name
});
export type FetchPRInput = z.infer<typeof FetchPRInputSchema>;

export const FetchCheckStatusInputSchema = z.object({
  checkId: IdSchema.optional(),
  prId: z.union([IdSchema, z.number().int().positive()]).optional(),
  branch: z.string().min(1).optional(),
  owner: z.string().min(1).optional(), // For GitHub: repo owner
  repo: z.string().min(1).optional(), // For GitHub: repo name
  sha: z.string().min(1).optional() // Commit SHA for GitHub
});
export type FetchCheckStatusInput = z.infer<typeof FetchCheckStatusInputSchema>;

export const FetchCommentsInputSchema = z.object({
  prId: z.union([IdSchema, z.number().int().positive()]).optional(),
  branch: z.string().min(1).optional(),
  owner: z.string().min(1).optional(), // For GitHub: repo owner
  repo: z.string().min(1).optional() // For GitHub: repo name
});
export type FetchCommentsInput = z.infer<typeof FetchCommentsInputSchema>;

export const FetchReviewInputSchema = z.object({
  reviewId: z.union([IdSchema, z.number().int().positive()]).optional(),
  reviewUrl: z.string().url().optional() // For Arcanum: review URL like https://code-review.example.com/review/10930804
});
export type FetchReviewInput = z.infer<typeof FetchReviewInputSchema>;

// Provider manifest (metadata)
export const CIProviderManifestSchema = z
  .object({
    type: z.literal('ci'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    protocolVersion: z.literal(CI_PROVIDER_PROTOCOL_VERSION),
    tools: z.array(z.string().min(1)),
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

export type CIProviderManifest = z.infer<typeof CIProviderManifestSchema>;

/**
 * CI provider interface
 */
export interface CIProvider {
  name: string;
  version: string;
  manifest: CIProviderManifest;
  tools?: Record<string, unknown>;
  vendor?: Record<string, unknown>;
  fetchPR(input: FetchPRInput): Promise<PRInfo>;
  fetchCheckStatus(input: FetchCheckStatusInput): Promise<CheckStatus[]>;
  fetchComments(input: FetchCommentsInput): Promise<Comment[]>;
  /**
   * Legacy/compat method. Review fetching is vendor-specific and should be exposed via
   * `ci.vendor.<namespace>.*` (e.g. `ci.vendor.arcanum.fetchReview`).
   */
  fetchReview?: (input: FetchReviewInput) => Promise<PRInfo>;
}

