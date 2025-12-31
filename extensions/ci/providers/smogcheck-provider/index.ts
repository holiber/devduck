import type {
  CIProvider,
  PRInfo,
  CheckStatus,
  Comment,
  FetchPRInput,
  FetchCheckStatusInput,
  FetchCommentsInput,
  FetchReviewInput
} from '../../schemas/contract.js';
import { CI_PROVIDER_PROTOCOL_VERSION } from '../../schemas/contract.js';
import { defineProvider } from '@barducks/sdk';
import type { ProviderToolsFromSpec } from '@barducks/sdk';

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

type CIToolsSpec = typeof import('../../spec.js').ciTools;
type CIVendorToolsSpec = typeof import('../../spec.js').ciVendorTools;

const tools = {
  async fetchPR(input: FetchPRInput): Promise<PRInfo> {
    let pr: PRInfo | null = null;

    if (input.prId) {
      pr = findPRById(input.prId);
    } else if (input.branch) {
      pr = findPRByBranch(input.branch);
    }

    if (!pr) {
      throw new Error(`PR not found: ${input.prId || input.branch || 'unknown'}`);
    }

    return pr;
  },

  async fetchCheckStatus(input: FetchCheckStatusInput): Promise<CheckStatus[]> {
    let prId: string | null = null;

    if (input.checkId) {
      // If checkId is provided, find the check directly
      for (const [pid, checks] of Object.entries(MOCK_CHECKS)) {
        const check = checks.find((c) => c.id === input.checkId);
        if (check) {
          return [check];
        }
      }
      throw new Error(`Check not found: ${input.checkId}`);
    }

    if (input.prId) {
      prId = String(input.prId);
    } else if (input.branch) {
      const pr = findPRByBranch(input.branch);
      if (pr) {
        prId = pr.id;
      }
    }

    if (!prId) {
      throw new Error(`Cannot determine PR ID from input: ${JSON.stringify(input)}`);
    }

    const checks = MOCK_CHECKS[prId] || [];
    return checks;
  },

  async fetchComments(input: FetchCommentsInput): Promise<Comment[]> {
    let prId: string | null = null;

    if (input.prId) {
      prId = String(input.prId);
    } else if (input.branch) {
      const pr = findPRByBranch(input.branch);
      if (pr) {
        prId = pr.id;
      }
    }

    if (!prId) {
      throw new Error(`Cannot determine PR ID from input: ${JSON.stringify(input)}`);
    }

    const comments = MOCK_COMMENTS[prId] || [];
    return comments;
  },

} satisfies ProviderToolsFromSpec<CIToolsSpec>;

const vendor = {
  arcanum: {
    async fetchReview(input: FetchReviewInput): Promise<PRInfo> {
      // For smogcheck provider, treat review as PR
      let reviewId: string | number | null = null;

      if (input.reviewUrl) {
        // Extract review ID from URL like https://code-review.example.com/review/10930804
        const match = input.reviewUrl.match(/review\/(\d+)/);
        if (match) {
          reviewId = Number.parseInt(match[1], 10);
        }
      } else if (input.reviewId) {
        reviewId = typeof input.reviewId === 'string' ? Number.parseInt(input.reviewId, 10) : input.reviewId;
      }

      if (!reviewId) {
        throw new Error(`Review not found: ${input.reviewId || input.reviewUrl || 'unknown'}`);
      }

      // For mock provider, return a mock PR based on review ID
      const pr = findPRById(reviewId);
      if (pr) {
        return pr;
      }

      // Return a default mock PR for review
      return {
        id: `review-${reviewId}`,
        number: reviewId,
        title: `Review ${reviewId}`,
        status: 'open',
        commentCount: 0,
        url: input.reviewUrl || `https://code-review.example.com/review/${reviewId}`,
        createdAt: nowMinusDays(1),
        updatedAt: nowMinusDays(1)
      };
    }
  }
} satisfies { arcanum: ProviderToolsFromSpec<CIVendorToolsSpec['arcanum']> };

const provider: CIProvider = defineProvider({
  type: 'ci',
  name: 'smogcheck-provider',
  version: '0.1.0',
  description: 'Test provider for CI module',
  protocolVersion: CI_PROVIDER_PROTOCOL_VERSION,
  tools,
  vendor,
  auth: { type: 'none', requiredTokens: [] },
  capabilities: ['pr', 'checks', 'comments']
});

export default provider;

