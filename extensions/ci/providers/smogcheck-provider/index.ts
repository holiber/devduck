import type {
  CIProvider,
  PRListInput,
  PRGetInput,
  PRPostInput,
  PRDeleteInput,
  PRChecksListInput,
  PRChecksGetInput,
  CommentListInput,
  CommentGetInput,
  CommentPostInput,
  CommentPutInput,
  CommentDeleteInput
} from '../../api.js';
import { CI_PROVIDER_PROTOCOL_VERSION } from '../../api.js';
import { defineProvider } from '@barducks/sdk';
import { db } from './smogcheck-provider-db.js';

const tools = {
  'pr.list': (input: PRListInput) => db.pr.list(input),
  'pr.get': (input: PRGetInput) => db.pr.get(input),
  'pr.post': (input: PRPostInput) => db.pr.post(input),
  'pr.delete': (input: PRDeleteInput) => db.pr.delete(input),
  'pr.checks.list': (input: PRChecksListInput) => db.pr.checks.list(input),
  'pr.checks.get': (input: PRChecksGetInput) => db.pr.checks.get(input),
  'comment.list': (input: CommentListInput) => db.comment.list(input),
  'comment.get': (input: CommentGetInput) => db.comment.get(input),
  'comment.post': (input: CommentPostInput) => db.comment.post(input),
  'comment.put': (input: CommentPutInput) => db.comment.put(input),
  'comment.delete': (input: CommentDeleteInput) => db.comment.delete(input)
} as const;

const base = defineProvider({
  type: 'ci',
  name: 'smogcheck-provider',
  version: '0.1.0',
  description: 'Test provider for CI module',
  protocolVersion: CI_PROVIDER_PROTOCOL_VERSION,
  tools,
  auth: { type: 'none', requiredTokens: [] },
  capabilities: ['pr', 'checks', 'comments']
}) as any;

const provider = {
  ...base,
  pr: {
    list: db.pr.list,
    get: db.pr.get,
    post: db.pr.post,
    delete: db.pr.delete,
    checks: {
      list: db.pr.checks.list,
      get: db.pr.checks.get
    }
  },
  comment: {
    list: db.comment.list,
    get: db.comment.get,
    post: db.comment.post,
    put: db.comment.put,
    delete: db.comment.delete
  }
} satisfies CIProvider;

export default provider;

