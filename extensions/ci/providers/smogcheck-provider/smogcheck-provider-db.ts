import type {
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

function nowMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

type DbState = {
  prs: PRInfo[];
  checksByPrId: Record<string, CheckStatus[]>;
  commentsByPrId: Record<string, Comment[]>;
};

function createInitialState(): DbState {
  const prs: PRInfo[] = [
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
        { id: 'reviewer-1', login: 'alice', name: 'Alice Smith', state: 'APPROVED' },
        { id: 'reviewer-2', login: 'bob', name: 'Bob Johnson', state: 'CHANGES_REQUESTED' }
      ],
      url: 'https://smogcheck.local/pr/123',
      branch: { from: 'feature/new-feature', to: 'main' },
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
      reviewers: [{ id: 'reviewer-1', login: 'alice', state: 'APPROVED' }],
      url: 'https://smogcheck.local/pr/124',
      branch: { from: 'fix/bug', to: 'main' },
      createdAt: nowMinusDays(5),
      updatedAt: nowMinusDays(3)
    }
  ];

  const checksByPrId: Record<string, CheckStatus[]> = {
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

  const commentsByPrId: Record<string, Comment[]> = {
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
        reactions: [{ type: 'THUMBS_UP', count: 2, users: ['bob', 'charlie'] }],
        url: 'https://smogcheck.local/pr/123/comments/comment-1'
      },
      {
        id: 'comment-2',
        body: 'I found an issue here',
        author: { id: 'reviewer-2', login: 'bob', name: 'Bob Johnson' },
        createdAt: nowMinusDays(1),
        path: 'src/main.ts',
        line: 42,
        reactions: [{ type: 'HEART', count: 1, users: ['alice'] }],
        isResolved: false,
        url: 'https://smogcheck.local/pr/123/comments/comment-2'
      },
      {
        id: 'comment-3',
        body: 'Fixed in latest commit',
        author: { id: 'author-1', login: 'author', name: 'PR Author' },
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
        author: { id: 'reviewer-1', login: 'alice', name: 'Alice Smith' },
        createdAt: nowMinusDays(4),
        reactions: [{ type: 'THUMBS_UP', count: 3, users: ['bob', 'charlie', 'dave'] }],
        url: 'https://smogcheck.local/pr/124/comments/comment-4'
      }
    ]
  };

  return { prs, checksByPrId, commentsByPrId };
}

function okResult(ok: boolean): DeleteResult {
  return { ok };
}

function findPRById(state: DbState, prId: string | number): PRInfo | null {
  const idStr = String(prId);
  return state.prs.find((pr) => pr.id === idStr || String(pr.number) === idStr) || null;
}

function findPRByBranch(state: DbState, branch: string): PRInfo | null {
  return state.prs.find((pr) => pr.branch?.from === branch) || null;
}

function resolvePRIdFromInput(
  state: DbState,
  input: { prId?: string | number; branch?: string }
): string | null {
  if (input.prId !== undefined && input.prId !== null && String(input.prId).trim()) {
    return String(input.prId);
  }
  if (input.branch) {
    const pr = findPRByBranch(state, input.branch);
    return pr ? pr.id : null;
  }
  return null;
}

export type SmogcheckProviderDb = {
  state: DbState;
  reset(): void;

  pr: {
    list(input: PRListInput): Promise<PRInfo[]>;
    get(input: PRGetInput): Promise<PRInfo>;
    post(input: PRPostInput): Promise<PRInfo>;
    delete(input: PRDeleteInput): Promise<DeleteResult>;
    checks: {
      list(input: PRChecksListInput): Promise<CheckStatus[]>;
      get(input: PRChecksGetInput): Promise<CheckStatus>;
    };
  };

  comment: {
    list(input: CommentListInput): Promise<Comment[]>;
    get(input: CommentGetInput): Promise<Comment>;
    post(input: CommentPostInput): Promise<Comment>;
    put(input: CommentPutInput): Promise<Comment>;
    delete(input: CommentDeleteInput): Promise<DeleteResult>;
  };
};

export function createSmogcheckProviderDb(): SmogcheckProviderDb {
  let state: DbState = createInitialState();

  return {
    get state() {
      return state;
    },

    reset() {
      state = createInitialState();
    },

    pr: {
      async list(input) {
        let prs = [...state.prs];
        if (input.branch) prs = prs.filter((pr) => pr.branch?.from === input.branch);
        if (input.status) prs = prs.filter((pr) => pr.status === input.status);
        if (input.limit) prs = prs.slice(0, input.limit);
        return prs;
      },

      async get(input) {
        const pr = findPRById(state, input.prId);
        if (!pr) throw new Error(`PR not found: ${input.prId}`);
        return pr;
      },

      async post(input) {
        const now = new Date().toISOString();
        const nextNumber =
          Math.max(0, ...state.prs.map((p) => (typeof p.number === 'number' ? p.number : 0))) + 1;
        const id = `pr-${Date.now()}`;

        const pr: PRInfo = {
          id,
          number: nextNumber,
          title: input.title,
          status: 'open',
          commentCount: 0,
          reviewers: [],
          url: `https://smogcheck.local/pr/${nextNumber}`,
          branch: { from: input.from, to: input.to },
          createdAt: now,
          updatedAt: now
        };

        state.prs.unshift(pr);
        return pr;
      },

      async delete(input) {
        const idStr = String(input.prId);
        const idx = state.prs.findIndex((pr) => pr.id === idStr || String(pr.number) === idStr);
        if (idx === -1) return okResult(false);
        const [removed] = state.prs.splice(idx, 1);
        delete state.checksByPrId[removed.id];
        delete state.commentsByPrId[removed.id];
        return okResult(true);
      },

      checks: {
        async list(input) {
          const prId = resolvePRIdFromInput(state, {
            prId: input.prId as string | number | undefined,
            branch: input.branch
          });
          if (!prId && !input.sha) {
            throw new Error(`Cannot determine PR from input: ${JSON.stringify(input)}`);
          }
          const checks = prId ? state.checksByPrId[prId] || [] : [];
          return input.limit ? checks.slice(0, input.limit) : checks;
        },

        async get(input) {
          for (const checks of Object.values(state.checksByPrId)) {
            const found = checks.find((c) => c.id === input.checkId);
            if (found) return found;
          }
          throw new Error(`Check not found: ${input.checkId}`);
        }
      }
    },

    comment: {
      async list(input) {
        const prId = resolvePRIdFromInput(state, {
          prId: input.prId as string | number | undefined,
          branch: input.branch
        });
        if (!prId) throw new Error(`Cannot determine PR from input: ${JSON.stringify(input)}`);
        const comments = state.commentsByPrId[prId] || [];
        return input.limit ? comments.slice(0, input.limit) : comments;
      },

      async get(input) {
        const idStr = String(input.commentId);
        for (const comments of Object.values(state.commentsByPrId)) {
          const found = comments.find((c) => c.id === idStr);
          if (found) return found;
        }
        throw new Error(`Comment not found: ${input.commentId}`);
      },

      async post(input) {
        const prId = resolvePRIdFromInput(state, {
          prId: input.prId as string | number | undefined,
          branch: input.branch
        });
        if (!prId) throw new Error(`Cannot determine PR from input: ${JSON.stringify(input)}`);

        const now = new Date().toISOString();
        const id = `comment-${Date.now()}`;
        const comment: Comment = {
          id,
          body: input.body,
          author: { id: 'barducks', login: 'barducks', name: 'Barducks', avatarUrl: undefined },
          createdAt: now,
          updatedAt: now,
          path: input.path,
          line: input.line,
          reactions: [],
          isResolved: false,
          url: `https://smogcheck.local/pr/${prId}/comments/${id}`
        };

        const list = (state.commentsByPrId[prId] = state.commentsByPrId[prId] || []);
        list.push(comment);
        return comment;
      },

      async put(input) {
        const idStr = String(input.commentId);
        for (const comments of Object.values(state.commentsByPrId)) {
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
      },

      async delete(input) {
        const idStr = String(input.commentId);
        for (const comments of Object.values(state.commentsByPrId)) {
          const idx = comments.findIndex((c) => c.id === idStr);
          if (idx >= 0) {
            comments.splice(idx, 1);
            return okResult(true);
          }
        }
        return okResult(false);
      }
    }
  };
}

export const db = createSmogcheckProviderDb();

