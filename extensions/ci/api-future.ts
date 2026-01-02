import { z } from 'zod';

import { defineExtension, publicProcedure, type Workspace } from '@barducks/sdk';

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

// REST-ish inputs
// PR
export const PRListInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  status: z.enum(['open', 'closed', 'merged', 'draft']).optional(),
  limit: z.number().int().positive().max(200).optional()
});
export type PRListInput = z.infer<typeof PRListInputSchema>;

export const PRGetInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  prId: z.union([IdSchema, z.number().int().positive()])
});
export type PRGetInput = z.infer<typeof PRGetInputSchema>;

export const PRPostInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  body: z.string().optional()
});
export type PRPostInput = z.infer<typeof PRPostInputSchema>;

export const PRDeleteInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  prId: z.union([IdSchema, z.number().int().positive()])
});
export type PRDeleteInput = z.infer<typeof PRDeleteInputSchema>;

// Checks (as subresource of PR)
export const PRChecksListInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  prId: z.union([IdSchema, z.number().int().positive()]).optional(),
  branch: z.string().min(1).optional(),
  sha: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional()
});
export type PRChecksListInput = z.infer<typeof PRChecksListInputSchema>;

export const PRChecksGetInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  checkId: IdSchema
});
export type PRChecksGetInput = z.infer<typeof PRChecksGetInputSchema>;

// Comments
export const CommentListInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  prId: z.union([IdSchema, z.number().int().positive()]).optional(),
  branch: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).optional()
});
export type CommentListInput = z.infer<typeof CommentListInputSchema>;

export const CommentGetInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  commentId: z.union([IdSchema, z.number().int().positive()])
});
export type CommentGetInput = z.infer<typeof CommentGetInputSchema>;

export const CommentPostInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  prId: z.union([IdSchema, z.number().int().positive()]).optional(),
  branch: z.string().min(1).optional(),
  body: z.string().min(1),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional()
});
export type CommentPostInput = z.infer<typeof CommentPostInputSchema>;

export const CommentPutInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  commentId: z.union([IdSchema, z.number().int().positive()]),
  body: z.string().min(1),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional()
});
export type CommentPutInput = z.infer<typeof CommentPutInputSchema>;

export const CommentDeleteInputSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  commentId: z.union([IdSchema, z.number().int().positive()])
});
export type CommentDeleteInput = z.infer<typeof CommentDeleteInputSchema>;

export const DeleteResultSchema = z.object({
  ok: z.boolean()
});
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

// Provider manifest (metadata)
export const CIProviderManifestSchema = z
  .object({
    type: z.literal('ci'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
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
  })
  .passthrough();

export type CIProviderManifest = z.infer<typeof CIProviderManifestSchema>;

// Provider object schema (best-effort): validates shape and cross-checks `manifest.tools` vs `api` keys.
export const CIProviderSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    manifest: CIProviderManifestSchema,
    api: z.record(z.any())
  })
  .passthrough()
  .superRefine((p, ctx) => {
    const tools = p.manifest?.tools || [];
    const apiKeys = p.api ? Object.keys(p.api) : [];
    for (const t of tools) {
      if (!apiKeys.includes(t)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Provider manifest.tools includes '${t}' but provider.api is missing this key`
        });
      }
    }
  });

export type CIProvider = z.infer<typeof CIProviderSchema>;



/**
 * Draft / future iteration of the CI module API.
 *
 * Not currently used by the runtime; kept as a reference while the provider API is evolving.
 */
export default defineExtension((ext: { ci: CIProvider }, workspace) => {
  const ws = workspace as unknown as Workspace;

  const ci = ext.ci.api;

  return {
    api: {
      'pr.list': publicProcedure
        .title('List pull requests')
        .input(PRListInputSchema)
        .return(z.array(PRInfoSchema))
        .query((input: PRListInput) => ci['pr.list'](input)),

      'pr.get': publicProcedure
        .title('Get pull request')
        .input(PRGetInputSchema)
        .return(PRInfoSchema)
        .query((input: PRGetInput) => ci['pr.get'](input)),

      'pr.post': publicProcedure
        .title('Create pull request')
        .input(PRPostInputSchema)
        .return(PRInfoSchema)
        .query((input: PRPostInput) => {
          const explicit = (input.projectId || '').trim();
          if (explicit) {
            // ensure project exists
            const rid = `project:${explicit}`;
            const inst = ws.resources.instances.get(rid);
            if (!inst || inst.resourceType !== 'project' || inst.enabled === false) {
              throw new Error(`Unknown projectId '${explicit}'. Register project or use a valid projectId.`);
            }
            return ci['pr.post'](input);
          }

          const active = ws.projects.getActive();
          if (!active) {
            throw new Error(
              'Multiple projects are registered (or none active). Provide projectId in pr.post input or call project.setActive.'
            );
          }

          return ci['pr.post']({ ...input, projectId: active.id });
        }),

      'pr.delete': publicProcedure
        .title('Delete pull request')
        .input(PRDeleteInputSchema)
        .return(DeleteResultSchema)
        .query((input: PRDeleteInput) => ci['pr.delete'](input)),

      'pr.checks.list': publicProcedure
        .title('List PR checks')
        .input(PRChecksListInputSchema)
        .return(z.array(CheckStatusSchema))
        .query((input: PRChecksListInput) => ci['pr.checks.list'](input)),

      'pr.checks.get': publicProcedure
        .title('Get PR check')
        .input(PRChecksGetInputSchema)
        .return(CheckStatusSchema)
        .query((input: PRChecksGetInput) => ci['pr.checks.get'](input)),

      'comment.list': publicProcedure
        .title('List comments')
        .input(CommentListInputSchema)
        .return(z.array(CommentSchema))
        .query((input: CommentListInput) => ci['comment.list'](input)),

      'comment.get': publicProcedure
        .title('Get comment')
        .input(CommentGetInputSchema)
        .return(CommentSchema)
        .query((input: CommentGetInput) => ci['comment.get'](input)),

      'comment.post': publicProcedure
        .title('Create comment')
        .input(CommentPostInputSchema)
        .return(CommentSchema)
        .query((input: CommentPostInput) => ci['comment.post'](input)),

      'comment.put': publicProcedure
        .title('Update comment')
        .input(CommentPutInputSchema)
        .return(CommentSchema)
        .query((input: CommentPutInput) => ci['comment.put'](input)),

      'comment.delete': publicProcedure
        .title('Delete comment')
        .input(CommentDeleteInputSchema)
        .return(DeleteResultSchema)
        .query((input: CommentDeleteInput) => ci['comment.delete'](input))

    },

    contracts: {
      ci: {
        'pr.list': publicProcedure.title('List pull requests').input(PRListInputSchema).return(z.array(PRInfoSchema)),
        'pr.get': publicProcedure.title('Get pull request').input(PRGetInputSchema).return(PRInfoSchema),
        'pr.post': publicProcedure.title('Create pull request').input(PRPostInputSchema).return(PRInfoSchema),
        'pr.delete': publicProcedure.title('Delete pull request').input(PRDeleteInputSchema).return(DeleteResultSchema),
        'pr.checks.list': publicProcedure
          .title('List PR checks')
          .input(PRChecksListInputSchema)
          .return(z.array(CheckStatusSchema)),
        'pr.checks.get': publicProcedure.title('Get PR check').input(PRChecksGetInputSchema).return(CheckStatusSchema),
        'comment.list': publicProcedure.title('List comments').input(CommentListInputSchema).return(z.array(CommentSchema)),
        'comment.get': publicProcedure.title('Get comment').input(CommentGetInputSchema).return(CommentSchema),
        'comment.post': publicProcedure.title('Create comment').input(CommentPostInputSchema).return(CommentSchema),
        'comment.put': publicProcedure.title('Update comment').input(CommentPutInputSchema).return(CommentSchema),
        'comment.delete': publicProcedure.title('Delete comment').input(CommentDeleteInputSchema).return(DeleteResultSchema)
      }
    }
  };
});

