import type {
  CIProvider,
  PRInfo,
  CheckStatus,
  Comment,
  DeleteResult,
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

function nowMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

const MOCK_PRS: PRInfo[] = [
  {
    id: 'pr-1',
    number: 123,
    title: 'Add new feature',
    status: 'open',
    commentCount: 5,
    mergeCheckStatus: {
      canMerge: false,
      checksTotal: 3,
      checksPassed: 2,
      checksFailed: 1,
      checksPending: 0
    },
    reviewers: [
      {
        id: 'reviewer-1',
        login: 'alice',
        name: 'Alice Smith',
        state: 'APPROVED'
      },
      {
        id: 'reviewer-2',
        login: 'bob',
        name: 'Bob Johnson',
        state: 'CHANGES_REQUESTED'
      }
    ],
    url: 'https://smogcheck.local/pr/123',
    branch: {
      from: 'feature/new-feature',
      to: 'main'
    },
    createdAt: nowMinusDays(2),
    updatedAt: nowMinusDays(1)
  },
  {
    id: 'pr-2',
    number: 124,
    title: 'Fix bug in module',
    status: 'open',
    commentCount: 2,
    mergeCheckStatus: {
      canMerge: true,
      checksTotal: 2,
      checksPassed: 2,
      checksFailed: 0,
      checksPending: 0
    },
    reviewers: [
      {
        id: 'reviewer-1',
        login: 'alice',
        state: 'APPROVED'
      }
    ],
    url: 'https://smogcheck.local/pr/124',
    branch: {
      from: 'fix/bug',
      to: 'main'
    },
    createdAt: nowMinusDays(5),
    updatedAt: nowMinusDays(3)
  }
];

const MOCK_CHECKS: Record<string, CheckStatus[]> = {
  'pr-1': [
    {
      id: 'check-1',
      name: 'Lint',
      status: 'completed',
      conclusion: 'success',
      url: 'https://smogcheck.local/checks/check-1',
      annotations: [],
      annotationsCount: 0
    },
    {
      id: 'check-2',
      name: 'Tests',
      status: 'completed',
      conclusion: 'success',
      url: 'https://smogcheck.local/checks/check-2',
      annotations: [],
      annotationsCount: 0
    },
    {
      id: 'check-3',
      name: 'Build',
      status: 'completed',
      conclusion: 'failure',
      url: 'https://smogcheck.local/checks/check-3',
      annotations: [
        {
          path: 'src/main.ts',
          startLine: 42,
          endLine: 42,
          message: 'Type error: expected string, got number',
          level: 'failure',
          title: 'Type error'
        },
        {
          path: 'src/utils.ts',
          startLine: 15,
          endLine: 15,
          message: 'Unused variable: unusedVar',
          level: 'warning',
          title: 'Unused variable'
        }
      ],
      annotationsCount: 2,
      annotationsUrl: 'https://smogcheck.local/checks/check-3/annotations',
      failureReason: 'Build failed with type errors',
      failureTitle: 'Build failure',
      failureDetails: [
        'src/main.ts:42: Type error: expected string, got number',
        'src/utils.ts:15: Unused variable: unusedVar'
      ],
      output: {
        summary: 'Build failed',
        text: 'Type errors detected in source files',
        title: 'Build failure'
      }
    }
  ],
  'pr-2': [
    {
      id: 'check-4',
      name: 'Lint',
      status: 'completed',
      conclusion: 'success',
      url: 'https://smogcheck.local/checks/check-4',
      annotations: [],
      annotationsCount: 0
    },
    {
      id: 'check-5',
      name: 'Tests',
      status: 'completed',
      conclusion: 'success',
      url: 'https://smogcheck.local/checks/check-5',
      annotations: [],
      annotationsCount: 0
    }
  ]
};

const MOCK_COMMENTS: Record<string, Comment[]> = {
  'pr-1': [
    {
      id: 'comment-1',
      body: 'Looks good, but please add more tests',
      author: {
        id: 'reviewer-1',
        login: 'alice',
        name: 'Alice Smith',
        avatarUrl: 'https://smogcheck.local/avatars/alice.png'
      },
      createdAt: nowMinusDays(2),
      updatedAt: nowMinusDays(2),
      reactions: [
        {
          type: 'THUMBS_UP',
          count: 2,
          users: ['bob', 'charlie']
        }
      ],
      url: 'https://smogcheck.local/pr/123/comments/comment-1'
    },
    {
      id: 'comment-2',
      body: 'I found an issue here',
      author: {
        id: 'reviewer-2',
        login: 'bob',
        name: 'Bob Johnson'
      },
      createdAt: nowMinusDays(1),
      path: 'src/main.ts',
      line: 42,
      reactions: [
        {
          type: 'HEART',
          count: 1,
          users: ['alice']
        }
      ],
      isResolved: false,
      url: 'https://smogcheck.local/pr/123/comments/comment-2'
    },
    {
      id: 'comment-3',
      body: 'Fixed in latest commit',
      author: {
        id: 'author-1',
        login: 'author',
        name: 'PR Author'
      },
      createdAt: nowMinusDays(1),
      path: 'src/main.ts',
      line: 42,
      reactions: [],
      isResolved: true,
      url: 'https://smogcheck.local/pr/123/comments/comment-3'
    }
  ],
  'pr-2': [
    {
      id: 'comment-4',
      body: 'Great fix!',
      author: {
        id: 'reviewer-1',
        login: 'alice',
        name: 'Alice Smith'
      },
      createdAt: nowMinusDays(4),
      reactions: [
        {
          type: 'THUMBS_UP',
          count: 3,
          users: ['bob', 'charlie', 'dave']
        }
      ],
      url: 'https://smogcheck.local/pr/124/comments/comment-4'
    }
  ]
};

function findPRById(prId: string | number): PRInfo | null {
  const idStr = String(prId);
  return MOCK_PRS.find((pr) => pr.id === idStr || String(pr.number) === idStr) || null;
}

function findPRByBranch(branch: string): PRInfo | null {
  return MOCK_PRS.find((pr) => pr.branch?.from === branch) || null;
}

function resolvePRIdFromInput(input: { prId?: string | number; branch?: string }): string | null {
  if (input.prId !== undefined && input.prId !== null && String(input.prId).trim()) {
    return String(input.prId);
  }
  if (input.branch) {
    const pr = findPRByBranch(input.branch);
    return pr ? pr.id : null;
  }
  return null;
}

function okResult(ok: boolean): DeleteResult {
  return { ok };
}

async function prList(input: PRListInput): Promise<PRInfo[]> {
  let prs = [...MOCK_PRS];
  if (input.branch) {
    prs = prs.filter((pr) => pr.branch?.from === input.branch);
  }
  if (input.status) {
    prs = prs.filter((pr) => pr.status === input.status);
  }
  if (input.limit) {
    prs = prs.slice(0, input.limit);
  }
  return prs;
}

async function prGet(input: PRGetInput): Promise<PRInfo> {
  const pr = findPRById(input.prId);
  if (!pr) throw new Error(`PR not found: ${input.prId}`);
  return pr;
}

async function prPost(input: PRPostInput): Promise<PRInfo> {
  const now = new Date().toISOString();
  const nextNumber =
    Math.max(0, ...MOCK_PRS.map((p) => (typeof p.number === 'number' ? p.number : 0))) + 1;
  const id = `pr-${Date.now()}`;

  const pr: PRInfo = {
    id,
    number: nextNumber,
    title: input.title,
    status: 'open',
    commentCount: 0,
    reviewers: [],
    url: `https://smogcheck.local/pr/${nextNumber}`,
    branch: {
      from: input.from,
      to: input.to
    },
    createdAt: now,
    updatedAt: now
  };

  MOCK_PRS.unshift(pr);
  return pr;
}

async function prDelete(input: PRDeleteInput): Promise<DeleteResult> {
  const idStr = String(input.prId);
  const idx = MOCK_PRS.findIndex((pr) => pr.id === idStr || String(pr.number) === idStr);
  if (idx === -1) return okResult(false);
  const [removed] = MOCK_PRS.splice(idx, 1);
  delete MOCK_CHECKS[removed.id];
  delete MOCK_COMMENTS[removed.id];
  return okResult(true);
}

async function prChecksList(input: PRChecksListInput): Promise<CheckStatus[]> {
  const prId = resolvePRIdFromInput({ prId: input.prId as string | number | undefined, branch: input.branch });
  if (!prId && !input.sha) {
    throw new Error(`Cannot determine PR from input: ${JSON.stringify(input)}`);
  }
  const checks = prId ? MOCK_CHECKS[prId] || [] : [];
  return input.limit ? checks.slice(0, input.limit) : checks;
}

async function prChecksGet(input: PRChecksGetInput): Promise<CheckStatus> {
  for (const checks of Object.values(MOCK_CHECKS)) {
    const found = checks.find((c) => c.id === input.checkId);
    if (found) return found;
  }
  throw new Error(`Check not found: ${input.checkId}`);
}

async function commentList(input: CommentListInput): Promise<Comment[]> {
  const prId = resolvePRIdFromInput({ prId: input.prId as string | number | undefined, branch: input.branch });
  if (!prId) throw new Error(`Cannot determine PR from input: ${JSON.stringify(input)}`);
  const comments = MOCK_COMMENTS[prId] || [];
  return input.limit ? comments.slice(0, input.limit) : comments;
}

async function commentGet(input: CommentGetInput): Promise<Comment> {
  const idStr = String(input.commentId);
  for (const comments of Object.values(MOCK_COMMENTS)) {
    const found = comments.find((c) => c.id === idStr);
    if (found) return found;
  }
  throw new Error(`Comment not found: ${input.commentId}`);
}

async function commentPost(input: CommentPostInput): Promise<Comment> {
  const prId = resolvePRIdFromInput({ prId: input.prId as string | number | undefined, branch: input.branch });
  if (!prId) throw new Error(`Cannot determine PR from input: ${JSON.stringify(input)}`);

  const now = new Date().toISOString();
  const id = `comment-${Date.now()}`;
  const comment: Comment = {
    id,
    body: input.body,
    author: {
      id: 'barducks',
      login: 'barducks',
      name: 'Barducks',
      avatarUrl: undefined
    },
    createdAt: now,
    updatedAt: now,
    path: input.path,
    line: input.line,
    reactions: [],
    isResolved: false,
    url: `https://smogcheck.local/pr/${prId}/comments/${id}`
  };

  const list = (MOCK_COMMENTS[prId] = MOCK_COMMENTS[prId] || []);
  list.push(comment);
  return comment;
}

async function commentPut(input: CommentPutInput): Promise<Comment> {
  const idStr = String(input.commentId);
  for (const comments of Object.values(MOCK_COMMENTS)) {
    const idx = comments.findIndex((c) => c.id === idStr);
    if (idx >= 0) {
      const prev = comments[idx];
      const next: Comment = {
        ...prev,
        body: input.body,
        path: input.path ?? prev.path,
        line: input.line ?? prev.line,
        updatedAt: new Date().toISOString()
      };
      comments[idx] = next;
      return next;
    }
  }
  throw new Error(`Comment not found: ${input.commentId}`);
}

async function commentDelete(input: CommentDeleteInput): Promise<DeleteResult> {
  const idStr = String(input.commentId);
  for (const comments of Object.values(MOCK_COMMENTS)) {
    const idx = comments.findIndex((c) => c.id === idStr);
    if (idx >= 0) {
      comments.splice(idx, 1);
      return okResult(true);
    }
  }
  return okResult(false);
}

const tools = {
  'pr.list': prList,
  'pr.get': prGet,
  'pr.post': prPost,
  'pr.delete': prDelete,
  'pr.checks.list': prChecksList,
  'pr.checks.get': prChecksGet,
  'comment.list': commentList,
  'comment.get': commentGet,
  'comment.post': commentPost,
  'comment.put': commentPut,
  'comment.delete': commentDelete
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
});

const provider = {
  ...base,
  pr: {
    list: prList,
    get: prGet,
    post: prPost,
    delete: prDelete,
    checks: {
      list: prChecksList,
      get: prChecksGet
    }
  },
  comment: {
    list: commentList,
    get: commentGet,
    post: commentPost,
    put: commentPut,
    delete: commentDelete
  }
} satisfies CIProvider;

export default provider;

