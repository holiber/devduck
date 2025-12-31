import { execSync } from 'child_process';
import type {
  CIProvider,
  PRInfo,
  CheckStatus,
  Comment,
  FetchPRInput,
  FetchCheckStatusInput,
  FetchCommentsInput,
  Annotation
} from '../../../ci/schemas/contract.js';
import { CI_PROVIDER_PROTOCOL_VERSION } from '../../../ci/schemas/contract.js';
import { defineProvider } from '@barducks/sdk';
import type { ProviderToolsFromSpec } from '@barducks/sdk';

interface RepoInfo {
  owner: string;
  repo: string;
}

function getRepoInfo(repoPath: string = process.cwd()): RepoInfo | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf8', stdio: 'pipe' }).trim();
    const remoteMatch = remoteUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!remoteMatch) {
      return null;
    }

    return {
      owner: remoteMatch[1],
      repo: remoteMatch[2].replace(/\.git$/, '')
    };
  } catch {
    return null;
  }
}

function ensureOwnerRepo(input: { owner?: string; repo?: string }): { owner: string; repo: string } {
  let owner = input.owner;
  let repo = input.repo;

  if (!owner || !repo) {
    const repoInfo = getRepoInfo();
    if (repoInfo) {
      owner = owner || repoInfo.owner;
      repo = repo || repoInfo.repo;
    }
  }

  if (!owner || !repo) {
    throw new Error(
      'github-provider: owner and repo are required. Ensure you are in a git repository with GitHub remote, or provide owner/repo in input.'
    );
  }

  return { owner, repo };
}

function requireAccessToken(): string {
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!token) {
    throw new Error(
      'github-provider: missing GITHUB_TOKEN. Set env var GITHUB_TOKEN (GitHub personal access token or OAuth token).'
    );
  }
  return token;
}

async function githubApiGet<T>(
  path: string,
  query: Record<string, string | number | undefined | Array<string | number | undefined>> = {}
): Promise<T> {
  const token = requireAccessToken();
  const url = new URL(`https://api.github.com/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null || item === '') continue;
        url.searchParams.append(k, String(item));
      }
      continue;
    }
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'barducks-github-provider'
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`github-provider: GitHub API error ${res.status} ${res.statusText}: ${body}`.trim());
  }

  return (await res.json()) as T;
}

type GitHubPR = {
  id?: number;
  number?: number;
  title?: string;
  state?: string;
  body?: string;
  user?: { login?: string; id?: number; avatar_url?: string };
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  comments?: number;
  review_comments?: number;
  requested_reviewers?: Array<{ login?: string; id?: number; avatar_url?: string }>;
  reviews?: Array<{ user?: { login?: string }; state?: string }>;
};

type GitHubCheckRun = {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  annotations_count?: number;
  annotations_url?: string;
  output?: {
    summary?: string;
    text?: string;
    title?: string;
    annotations_count?: number;
  };
};

type GitHubAnnotation = {
  path?: string;
  start_line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  message?: string;
  annotation_level?: string;
  title?: string;
};

type GitHubComment = {
  id?: number;
  body?: string;
  user?: { login?: string; id?: number; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  path?: string;
  line?: number;
  html_url?: string;
  reactions?: {
    total_count?: number;
    '+1'?: number;
    '-1'?: number;
    laugh?: number;
    hooray?: number;
    confused?: number;
    heart?: number;
    rocket?: number;
    eyes?: number;
  };
};

type GitHubReview = {
  id?: number;
  user?: { login?: string; id?: number; avatar_url?: string };
  state?: string;
  body?: string;
  submitted_at?: string;
};

function toContractPRInfo(pr: GitHubPR, owner: string, repo: string): PRInfo {
  const id = String(pr.id || pr.number || '');
  if (!id) {
    throw new Error('github-provider: GitHub API returned a PR without id or number');
  }

  const status = pr.state === 'open' ? 'open' : pr.state === 'closed' ? 'closed' : pr.state === 'merged' ? 'merged' : 'draft';
  const commentCount = (pr.comments || 0) + (pr.review_comments || 0);

  // Get reviewers from requested_reviewers and reviews
  const reviewers: PRInfo['reviewers'] = [];
  if (pr.requested_reviewers) {
    for (const r of pr.requested_reviewers) {
      reviewers.push({
        id: String(r.id || ''),
        login: r.login || 'unknown',
        avatarUrl: r.avatar_url,
        state: 'PENDING'
      });
    }
  }
  if (pr.reviews) {
    for (const review of pr.reviews) {
      const login = review.user?.login;
      if (!login) continue;
      const existing = reviewers.find((r) => r.login === login);
      if (existing) {
        const state = review.state === 'APPROVED' ? 'APPROVED' : review.state === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : review.state === 'COMMENTED' ? 'COMMENTED' : 'PENDING';
        existing.state = state;
      } else {
        reviewers.push({
          id: '',
          login,
          state: review.state === 'APPROVED' ? 'APPROVED' : review.state === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : review.state === 'COMMENTED' ? 'COMMENTED' : 'PENDING'
        });
      }
    }
  }

  // Get check runs to determine merge check status
  // This will be populated by fetchCheckStatus if needed
  const mergeCheckStatus: PRInfo['mergeCheckStatus'] = undefined;

  return {
    id,
    number: pr.number,
    title: pr.title || '',
    status,
    state: pr.state,
    commentCount,
    mergeCheckStatus,
    reviewers,
    url: pr.html_url,
    branch: {
      from: pr.head?.ref,
      to: pr.base?.ref,
      head: pr.head?.sha,
      base: pr.base?.ref
    },
    createdAt: pr.created_at,
    updatedAt: pr.updated_at
  };
}

function toContractAnnotation(ann: GitHubAnnotation): Annotation {
  return {
    path: ann.path,
    startLine: ann.start_line,
    endLine: ann.end_line,
    startColumn: ann.start_column,
    endColumn: ann.end_column,
    message: ann.message || '',
    level: ann.annotation_level === 'notice' ? 'notice' : ann.annotation_level === 'warning' ? 'warning' : ann.annotation_level === 'failure' ? 'failure' : undefined,
    title: ann.title
  };
}

function toContractCheckStatus(check: GitHubCheckRun, annotations: GitHubAnnotation[] = []): CheckStatus {
  const id = String(check.id || '');
  if (!id) {
    throw new Error('github-provider: GitHub API returned a check run without id');
  }

  const status = check.status === 'completed' ? 'completed' : check.status === 'in_progress' ? 'in_progress' : check.status === 'queued' ? 'queued' : 'pending';
  const conclusion = check.conclusion === 'success' ? 'success' : check.conclusion === 'failure' ? 'failure' : check.conclusion === 'cancelled' ? 'cancelled' : check.conclusion === 'skipped' ? 'skipped' : check.conclusion === 'neutral' ? 'neutral' : check.conclusion === 'action_required' ? 'action_required' : null;

  const contractAnnotations = annotations.map(toContractAnnotation);

  let failureReason: string | undefined;
  let failureTitle: string | undefined;
  let failureDetails: string[] | undefined;

  if (conclusion === 'failure' || conclusion === 'action_required') {
    if (check.output) {
      failureReason = check.output.summary || check.output.text || undefined;
      failureTitle = check.output.title || undefined;
    }
    if (contractAnnotations.length > 0) {
      failureDetails = contractAnnotations.map((ann) => {
        const location = ann.path ? `${ann.path}:${ann.startLine || ''}` : '';
        return location ? `${location}: ${ann.message}` : ann.message;
      });
      if (!failureReason && failureDetails.length > 0) {
        failureReason = failureDetails[0];
      }
    }
  }

  return {
    id,
    name: check.name || 'Unknown',
    status,
    conclusion,
    url: check.html_url,
    annotations: contractAnnotations,
    annotationsCount: check.annotations_count || contractAnnotations.length,
    annotationsUrl: check.annotations_url,
    failureReason,
    failureTitle,
    failureDetails,
    output: check.output
      ? {
          summary: check.output.summary,
          text: check.output.text,
          title: check.output.title
        }
      : undefined
  };
}

function toContractComment(comment: GitHubComment): Comment {
  const id = String(comment.id || '');
  if (!id) {
    throw new Error('github-provider: GitHub API returned a comment without id');
  }

  const reactions: Comment['reactions'] = [];
  if (comment.reactions) {
    if (comment.reactions['+1'] && comment.reactions['+1'] > 0) {
      reactions.push({ type: 'THUMBS_UP', count: comment.reactions['+1'], users: [] });
    }
    if (comment.reactions['-1'] && comment.reactions['-1'] > 0) {
      reactions.push({ type: 'THUMBS_DOWN', count: comment.reactions['-1'], users: [] });
    }
    if (comment.reactions.heart && comment.reactions.heart > 0) {
      reactions.push({ type: 'HEART', count: comment.reactions.heart, users: [] });
    }
    if (comment.reactions.laugh && comment.reactions.laugh > 0) {
      reactions.push({ type: 'LAUGH', count: comment.reactions.laugh, users: [] });
    }
    if (comment.reactions.hooray && comment.reactions.hooray > 0) {
      reactions.push({ type: 'HOORAY', count: comment.reactions.hooray, users: [] });
    }
    if (comment.reactions.rocket && comment.reactions.rocket > 0) {
      reactions.push({ type: 'ROCKET', count: comment.reactions.rocket, users: [] });
    }
    if (comment.reactions.eyes && comment.reactions.eyes > 0) {
      reactions.push({ type: 'EYES', count: comment.reactions.eyes, users: [] });
    }
  }

  return {
    id,
    body: comment.body || '',
    author: {
      id: String(comment.user?.id || ''),
      login: comment.user?.login || 'unknown',
      avatarUrl: comment.user?.avatar_url,
      name: undefined
    },
    createdAt: comment.created_at || new Date().toISOString(),
    updatedAt: comment.updated_at,
    path: comment.path,
    line: comment.line,
    reactions,
    isResolved: false, // GitHub doesn't have resolved status for PR comments
    url: comment.html_url
  };
}

async function getPRByNumber(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
  return await githubApiGet<GitHubPR>(`repos/${owner}/${repo}/pulls/${prNumber}`);
}

async function getPRByBranch(owner: string, repo: string, branch: string): Promise<GitHubPR | null> {
  const prs = await githubApiGet<GitHubPR[]>(`repos/${owner}/${repo}/pulls`, { state: 'open', head: `${owner}:${branch}` });
  return prs.length > 0 ? prs[0] : null;
}

async function getCheckRuns(owner: string, repo: string, sha: string): Promise<GitHubCheckRun[]> {
  const response = await githubApiGet<{ check_runs?: GitHubCheckRun[] }>(`repos/${owner}/${repo}/commits/${sha}/check-runs`, {
    per_page: 100
  });
  return response.check_runs || [];
}

async function getCheckAnnotations(owner: string, repo: string, checkRunId: number): Promise<GitHubAnnotation[]> {
  try {
    return await githubApiGet<GitHubAnnotation[]>(`repos/${owner}/${repo}/check-runs/${checkRunId}/annotations`, {
      per_page: 100
    });
  } catch (error) {
    // If annotations endpoint fails, return empty array
    return [];
  }
}

async function getPRComments(owner: string, repo: string, prNumber: number): Promise<GitHubComment[]> {
  return await githubApiGet<GitHubComment[]>(`repos/${owner}/${repo}/pulls/${prNumber}/comments`, { per_page: 100 });
}

async function getIssueComments(owner: string, repo: string, issueNumber: number): Promise<GitHubComment[]> {
  return await githubApiGet<GitHubComment[]>(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, { per_page: 100 });
}

async function getPRReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]> {
  return await githubApiGet<GitHubReview[]>(`repos/${owner}/${repo}/pulls/${prNumber}/reviews`, { per_page: 100 });
}

type CIToolsSpec = typeof import('../../../ci/spec.js').ciTools;

const tools = {
  async fetchPR(input: FetchPRInput): Promise<PRInfo> {
    const { owner, repo } = ensureOwnerRepo(input);

    let pr: GitHubPR | null = null;

    if (input.prId) {
      const prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
      if (!Number.isFinite(prNumber)) {
        throw new Error(`github-provider: invalid PR ID: ${input.prId}`);
      }
      pr = await getPRByNumber(owner, repo, prNumber);
    } else if (input.branch) {
      pr = await getPRByBranch(owner, repo, input.branch);
      if (!pr) {
        throw new Error(`github-provider: PR not found for branch: ${input.branch}`);
      }
    } else {
      throw new Error('github-provider: prId or branch is required');
    }

    const prInfo = toContractPRInfo(pr, owner, repo);

    // Get reviews to populate reviewers
    const reviews = await getPRReviews(owner, repo, pr.number || Number.parseInt(prInfo.id, 10));
    for (const review of reviews) {
      const login = review.user?.login;
      if (!login) continue;
      const existing = prInfo.reviewers.find((r) => r.login === login);
      if (existing) {
        const state = review.state === 'APPROVED' ? 'APPROVED' : review.state === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : review.state === 'COMMENTED' ? 'COMMENTED' : 'PENDING';
        existing.state = state;
      } else {
        prInfo.reviewers.push({
          id: String(review.user?.id || ''),
          login,
          avatarUrl: review.user?.avatar_url,
          state: review.state === 'APPROVED' ? 'APPROVED' : review.state === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : review.state === 'COMMENTED' ? 'COMMENTED' : 'PENDING'
        });
      }
    }

    return prInfo;
  },

  async fetchCheckStatus(input: FetchCheckStatusInput): Promise<CheckStatus[]> {
    const { owner, repo } = ensureOwnerRepo(input);

    let sha: string | null = null;

    if (input.checkId) {
      // If checkId is provided, we need to get the check run directly
      // But GitHub API doesn't support getting check run by ID without knowing the ref
      // So we'll need sha or prId
      if (input.sha) {
        sha = input.sha;
      } else if (input.prId) {
        const prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
        const pr = await getPRByNumber(owner, repo, prNumber);
        sha = pr.head?.sha || null;
      } else {
        throw new Error('github-provider: sha or prId is required when checkId is specified');
      }

      if (!sha) {
        throw new Error('github-provider: cannot determine SHA for check');
      }

      const checkRuns = await getCheckRuns(owner, repo, sha);
      const check = checkRuns.find((c) => String(c.id) === String(input.checkId));
      if (!check) {
        throw new Error(`github-provider: check not found: ${input.checkId}`);
      }

      const annotations = await getCheckAnnotations(owner, repo, check.id || 0);
      return [toContractCheckStatus(check, annotations)];
    }

    // Get SHA from PR or branch
    if (input.sha) {
      sha = input.sha;
    } else if (input.prId) {
      const prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
      const pr = await getPRByNumber(owner, repo, prNumber);
      sha = pr.head?.sha || null;
    } else if (input.branch) {
      const pr = await getPRByBranch(owner, repo, input.branch);
      if (pr) {
        sha = pr.head?.sha || null;
      }
    }

    if (!sha) {
      throw new Error('github-provider: cannot determine SHA. Provide sha, prId, or branch');
    }

    const checkRuns = await getCheckRuns(owner, repo, sha);
    const checks: CheckStatus[] = [];

    for (const check of checkRuns) {
      const annotations = await getCheckAnnotations(owner, repo, check.id || 0);
      checks.push(toContractCheckStatus(check, annotations));
    }

    return checks;
  },

  async fetchComments(input: FetchCommentsInput): Promise<Comment[]> {
    const { owner, repo } = ensureOwnerRepo(input);

    let prNumber: number | null = null;

    if (input.prId) {
      prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
    } else if (input.branch) {
      const pr = await getPRByBranch(owner, repo, input.branch);
      if (!pr) {
        throw new Error(`github-provider: PR not found for branch: ${input.branch}`);
      }
      prNumber = pr.number || null;
    } else {
      throw new Error('github-provider: prId or branch is required');
    }

    if (!prNumber) {
      throw new Error('github-provider: cannot determine PR number');
    }

    // Fetch both review comments (code comments) and issue comments (general PR comments)
    const [reviewComments, issueComments] = await Promise.all([
      getPRComments(owner, repo, prNumber),
      getIssueComments(owner, repo, prNumber)
    ]);

    // Combine both types of comments
    const allComments = [...reviewComments, ...issueComments];
    return allComments.map(toContractComment);
  }
} satisfies ProviderToolsFromSpec<CIToolsSpec>;

const provider: CIProvider = defineProvider({
  type: 'ci',
  name: 'github-provider',
  version: '0.1.0',
  description: 'GitHub provider for CI module (GitHub API)',
  protocolVersion: CI_PROVIDER_PROTOCOL_VERSION,
  tools,
  // vendor defaults to {}
  auth: { type: 'apiKey', requiredTokens: ['GITHUB_TOKEN'] },
  capabilities: ['pr', 'checks', 'comments']
});

export default provider;

