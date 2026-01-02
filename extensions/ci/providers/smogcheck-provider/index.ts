import type {
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
import { db } from './smogcheck-provider-db.js';
import type { Extension, Workspace } from '@barducks/sdk';

export function activate(_workspace: Workspace, ext: Extension) {
  ext.defineProvider({
    type: 'ci',
    name: 'smogcheck-provider',
    version: '0.1.0',
    description: 'Test provider for CI module',
    api: {
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
    } as const
  });
}

