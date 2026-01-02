import { execSync } from 'child_process';

import { defineProvider } from '@barducks/sdk';

import type {
  Annotation,
  CIProvider,
  CheckStatus,
  Comment,
  CommentDeleteInput,
  CommentGetInput,
  CommentListInput,
  CommentPostInput,
  CommentPutInput,
  DeleteResult,
  PRChecksGetInput,
  PRChecksListInput,
  PRDeleteInput,
  PRGetInput,
  PRInfo,
  PRListInput,
  PRPostInput
} from '../../../ci/api.js';
import { CI_PROVIDER_PROTOCOL_VERSION } from '../../../ci/api.js';

type RepoInfo = {
  owner: string;
  repo: string;
};

function getRepoInfo(repoPath: string = process.cwd()): RepoInfo | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    const remoteMatch = remoteUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!remoteMatch) return null;
    return { owner: remoteMatch[1], repo: remoteMatch[2].replace(/\.git$/, '') };
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
    throw new Error('github-provider: missing GITHUB_TOKEN. Set env var GITHUB_TOKEN.');
  }
  return token;
}

type QueryValue = string | number | undefined | Array<string | number | undefined>;

async function githubApi<T>(args: {
  method: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
}): Promise<T> {
  const token = requireAccessToken();
  const url = new URL(`https://api.github.com/${args.path.replace(/^\//, '')}`);
  const query = args.query || {};
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
    method: args.method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'barducks-github-provider',
      ...(args.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`github-provider: GitHub API error ${res.status} ${res.statusText}: ${text}`.trim());
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function githubApiGet<T>(path: string, query: Record<string, QueryValue> = {}): Promise<T> {
  return await githubApi<T>({ method: 'GET', path, query });
}
async function githubApiPost<T>(path: string, body: unknown): Promise<T> {
  return await githubApi<T>({ method: 'POST', path, body });
}
async function githubApiPatch<T>(path: string, body: unknown): Promise<T> {
  return await githubApi<T>({ method: 'PATCH', path, body });
}
async function githubApiDelete(path: string): Promise<void> {
  await githubApi<void>({ method: 'DELETE', path });
}

type GitHubPR = {
  id?: number;
  number?: number;
  title?: string;
  state?: 'open' | 'closed';
  draft?: boolean;
  merged_at?: string | null;
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

type GitHubIssueComment = {
  id?: number;
  body?: string;
  user?: { login?: string; id?: number; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
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

type GitHubReviewComment = GitHubIssueComment & {
  path?: string;
  line?: number;
};

function toContractPRInfo(pr: GitHubPR): PRInfo {
  const id = String(pr.id || pr.number || '');
  if (!id) throw new Error('github-provider: GitHub API returned a PR without id or number');

  const status =
    pr.state === 'open'
      ? pr.draft
        ? 'draft'
        : 'open'
      : pr.merged_at
        ? 'merged'
        : 'closed';

  return {
    id,
    number: pr.number,
    title: pr.title || '',
    status,
    state: pr.state,
    commentCount: (pr.comments || 0) + (pr.review_comments || 0),
    mergeCheckStatus: undefined,
    reviewers: (pr.requested_reviewers || []).map((r) => ({
      id: String(r.id || ''),
      login: r.login || 'unknown',
      avatarUrl: r.avatar_url,
      state: 'PENDING'
    })),
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
    level:
      ann.annotation_level === 'notice'
        ? 'notice'
        : ann.annotation_level === 'warning'
          ? 'warning'
          : ann.annotation_level === 'failure'
            ? 'failure'
            : undefined,
    title: ann.title
  };
}

function toContractCheckStatus(check: GitHubCheckRun, annotations: GitHubAnnotation[] = []): CheckStatus {
  const id = String(check.id || '');
  if (!id) throw new Error('github-provider: GitHub API returned a check run without id');

  const status =
    check.status === 'completed'
      ? 'completed'
      : check.status === 'in_progress'
        ? 'in_progress'
        : check.status === 'queued'
          ? 'queued'
          : 'pending';

  const conclusion =
    check.conclusion === 'success'
      ? 'success'
      : check.conclusion === 'failure'
        ? 'failure'
        : check.conclusion === 'cancelled'
          ? 'cancelled'
          : check.conclusion === 'skipped'
            ? 'skipped'
            : check.conclusion === 'neutral'
              ? 'neutral'
              : check.conclusion === 'action_required'
                ? 'action_required'
                : null;

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
      if (!failureReason && failureDetails.length > 0) failureReason = failureDetails[0];
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

function toContractComment(comment: GitHubIssueComment | GitHubReviewComment): Comment {
  const id = String(comment.id || '');
  if (!id) throw new Error('github-provider: GitHub API returned a comment without id');

  const reactions: Comment['reactions'] = [];
  const r = comment.reactions;
  if (r) {
    if (r['+1'] && r['+1'] > 0) reactions.push({ type: 'THUMBS_UP', count: r['+1'], users: [] });
    if (r['-1'] && r['-1'] > 0) reactions.push({ type: 'THUMBS_DOWN', count: r['-1'], users: [] });
    if (r.heart && r.heart > 0) reactions.push({ type: 'HEART', count: r.heart, users: [] });
    if (r.laugh && r.laugh > 0) reactions.push({ type: 'LAUGH', count: r.laugh, users: [] });
    if (r.hooray && r.hooray > 0) reactions.push({ type: 'HOORAY', count: r.hooray, users: [] });
    if (r.rocket && r.rocket > 0) reactions.push({ type: 'ROCKET', count: r.rocket, users: [] });
    if (r.eyes && r.eyes > 0) reactions.push({ type: 'EYES', count: r.eyes, users: [] });
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
    path: (comment as GitHubReviewComment).path,
    line: (comment as GitHubReviewComment).line,
    reactions,
    isResolved: false,
    url: comment.html_url
  };
}

async function getPRByNumber(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
  return await githubApiGet<GitHubPR>(`repos/${owner}/${repo}/pulls/${prNumber}`);
}

async function getPRByBranch(owner: string, repo: string, branch: string): Promise<GitHubPR | null> {
  const prs = await githubApiGet<GitHubPR[]>(`repos/${owner}/${repo}/pulls`, {
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 10
  });
  return prs.length > 0 ? prs[0] : null;
}

async function listPRs(owner: string, repo: string, args: { state: 'open' | 'closed' | 'all'; per_page: number }): Promise<GitHubPR[]> {
  return await githubApiGet<GitHubPR[]>(`repos/${owner}/${repo}/pulls`, args as any);
}

async function createPR(owner: string, repo: string, args: { title: string; head: string; base: string; body?: string }): Promise<GitHubPR> {
  return await githubApiPost<GitHubPR>(`repos/${owner}/${repo}/pulls`, args);
}

async function closePR(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
  return await githubApiPatch<GitHubPR>(`repos/${owner}/${repo}/pulls/${prNumber}`, { state: 'closed' });
}

async function getCheckRuns(owner: string, repo: string, sha: string, perPage = 100): Promise<GitHubCheckRun[]> {
  const response = await githubApiGet<{ check_runs?: GitHubCheckRun[] }>(`repos/${owner}/${repo}/commits/${sha}/check-runs`, {
    per_page: perPage
  });
  return response.check_runs || [];
}

async function getCheckRunById(owner: string, repo: string, checkRunId: number): Promise<GitHubCheckRun> {
  return await githubApiGet<GitHubCheckRun>(`repos/${owner}/${repo}/check-runs/${checkRunId}`);
}

async function getCheckAnnotations(owner: string, repo: string, checkRunId: number, perPage = 100): Promise<GitHubAnnotation[]> {
  try {
    return await githubApiGet<GitHubAnnotation[]>(`repos/${owner}/${repo}/check-runs/${checkRunId}/annotations`, { per_page: perPage });
  } catch {
    return [];
  }
}

async function getPRReviewComments(owner: string, repo: string, prNumber: number, perPage = 100): Promise<GitHubReviewComment[]> {
  return await githubApiGet<GitHubReviewComment[]>(`repos/${owner}/${repo}/pulls/${prNumber}/comments`, { per_page: perPage });
}

async function getIssueComments(owner: string, repo: string, issueNumber: number, perPage = 100): Promise<GitHubIssueComment[]> {
  return await githubApiGet<GitHubIssueComment[]>(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, { per_page: perPage });
}

async function getIssueComment(owner: string, repo: string, commentId: number): Promise<GitHubIssueComment> {
  return await githubApiGet<GitHubIssueComment>(`repos/${owner}/${repo}/issues/comments/${commentId}`);
}

async function updateIssueComment(owner: string, repo: string, commentId: number, body: string): Promise<GitHubIssueComment> {
  return await githubApiPatch<GitHubIssueComment>(`repos/${owner}/${repo}/issues/comments/${commentId}`, { body });
}

async function deleteIssueComment(owner: string, repo: string, commentId: number): Promise<void> {
  await githubApiDelete(`repos/${owner}/${repo}/issues/comments/${commentId}`);
      }

async function postIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<GitHubIssueComment> {
  return await githubApiPost<GitHubIssueComment>(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
}

function okResult(ok: boolean): DeleteResult {
  return { ok };
    }

async function prList(input: PRListInput): Promise<PRInfo[]> {
  const { owner, repo } = ensureOwnerRepo(input);
  const per_page = input.limit || 30;

  if (input.branch) {
    const pr = await getPRByBranch(owner, repo, input.branch);
    if (!pr) return [];
    const out = [toContractPRInfo(pr)];
    return input.status ? out.filter((p) => p.status === input.status) : out;
  }

  const state: 'open' | 'closed' | 'all' =
    input.status === 'open' ? 'open' : input.status === 'closed' ? 'closed' : 'all';
  const prs = await listPRs(owner, repo, { state, per_page });
  const mapped = prs.map(toContractPRInfo);
  return input.status ? mapped.filter((p) => p.status === input.status) : mapped;
}

async function prGet(input: PRGetInput): Promise<PRInfo> {
    const { owner, repo } = ensureOwnerRepo(input);
        const prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
  if (!Number.isFinite(prNumber)) throw new Error(`github-provider: invalid prId: ${input.prId}`);
        const pr = await getPRByNumber(owner, repo, prNumber);
  return toContractPRInfo(pr);
}

async function prPost(input: PRPostInput): Promise<PRInfo> {
  const { owner, repo } = ensureOwnerRepo(input);
  const head = String(input.from || '').trim();
  const base = String(input.to || '').trim();
  if (!head || !base) {
    throw new Error('github-provider: pr.post requires from (head) and to (base)');
      }
  const pr = await createPR(owner, repo, { title: input.title, head, base, body: input.body });
  return toContractPRInfo(pr);
}

async function prDelete(input: PRDeleteInput): Promise<DeleteResult> {
  const { owner, repo } = ensureOwnerRepo(input);
  const prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
  if (!Number.isFinite(prNumber)) throw new Error(`github-provider: invalid prId: ${input.prId}`);
  await closePR(owner, repo, prNumber);
  return okResult(true);
}

async function prChecksList(input: PRChecksListInput): Promise<CheckStatus[]> {
  const { owner, repo } = ensureOwnerRepo(input);
  let sha: string | null = null;

    if (input.sha) {
      sha = input.sha;
  } else if (input.prId !== undefined && input.prId !== null) {
      const prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
      const pr = await getPRByNumber(owner, repo, prNumber);
      sha = pr.head?.sha || null;
    } else if (input.branch) {
      const pr = await getPRByBranch(owner, repo, input.branch);
    sha = pr?.head?.sha || null;
    }

  if (!sha) throw new Error('github-provider: cannot determine SHA. Provide sha, prId, or branch');

  const checkRuns = await getCheckRuns(owner, repo, sha, input.limit || 100);
    const checks: CheckStatus[] = [];
    for (const check of checkRuns) {
    const annotations = await getCheckAnnotations(owner, repo, check.id || 0, 100);
      checks.push(toContractCheckStatus(check, annotations));
    if (input.limit && checks.length >= input.limit) break;
  }
    return checks;
}

async function prChecksGet(input: PRChecksGetInput): Promise<CheckStatus> {
  const { owner, repo } = ensureOwnerRepo(input);
  const checkRunId = Number.parseInt(String(input.checkId), 10);
  if (!Number.isFinite(checkRunId)) throw new Error(`github-provider: invalid checkId: ${input.checkId}`);
  const check = await getCheckRunById(owner, repo, checkRunId);
  const annotations = await getCheckAnnotations(owner, repo, checkRunId, 100);
  return toContractCheckStatus(check, annotations);
}

async function commentList(input: CommentListInput): Promise<Comment[]> {
    const { owner, repo } = ensureOwnerRepo(input);
    let prNumber: number | null = null;

  if (input.prId !== undefined && input.prId !== null) {
      prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
    } else if (input.branch) {
      const pr = await getPRByBranch(owner, repo, input.branch);
    prNumber = pr?.number || null;
  }

  if (!prNumber) throw new Error('github-provider: cannot determine PR number (prId or branch required)');

  const perPage = input.limit || 100;
  const [reviewComments, issueComments] = await Promise.all([
    getPRReviewComments(owner, repo, prNumber, perPage),
    getIssueComments(owner, repo, prNumber, perPage)
  ]);
  const all = [...reviewComments, ...issueComments].map(toContractComment);
  return input.limit ? all.slice(0, input.limit) : all;
      }

async function commentGet(input: CommentGetInput): Promise<Comment> {
  const { owner, repo } = ensureOwnerRepo(input);
  const commentId = typeof input.commentId === 'number' ? input.commentId : Number.parseInt(String(input.commentId), 10);
  if (!Number.isFinite(commentId)) throw new Error(`github-provider: invalid commentId: ${input.commentId}`);
  const comment = await getIssueComment(owner, repo, commentId);
  return toContractComment(comment);
}

async function commentPost(input: CommentPostInput): Promise<Comment> {
  const { owner, repo } = ensureOwnerRepo(input);
  if (input.path || input.line) {
    throw new Error('github-provider: comment.post with path/line is not supported yet');
  }

  let prNumber: number | null = null;
  if (input.prId !== undefined && input.prId !== null) {
    prNumber = typeof input.prId === 'number' ? input.prId : Number.parseInt(String(input.prId), 10);
  } else if (input.branch) {
    const pr = await getPRByBranch(owner, repo, input.branch);
    prNumber = pr?.number || null;
  }
  if (!prNumber) throw new Error('github-provider: cannot determine PR number (prId or branch required)');

  const created = await postIssueComment(owner, repo, prNumber, input.body);
  return toContractComment(created);
}

async function commentPut(input: CommentPutInput): Promise<Comment> {
  const { owner, repo } = ensureOwnerRepo(input);
  if (input.path || input.line) {
    throw new Error('github-provider: comment.put with path/line is not supported yet');
  }
  const commentId = typeof input.commentId === 'number' ? input.commentId : Number.parseInt(String(input.commentId), 10);
  if (!Number.isFinite(commentId)) throw new Error(`github-provider: invalid commentId: ${input.commentId}`);
  const updated = await updateIssueComment(owner, repo, commentId, input.body);
  return toContractComment(updated);
}

async function commentDelete(input: CommentDeleteInput): Promise<DeleteResult> {
  const { owner, repo } = ensureOwnerRepo(input);
  const commentId = typeof input.commentId === 'number' ? input.commentId : Number.parseInt(String(input.commentId), 10);
  if (!Number.isFinite(commentId)) throw new Error(`github-provider: invalid commentId: ${input.commentId}`);
  await deleteIssueComment(owner, repo, commentId);
  return okResult(true);
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
  name: 'github-provider',
  version: '0.1.0',
  description: 'GitHub provider for CI module (GitHub API)',
  protocolVersion: CI_PROVIDER_PROTOCOL_VERSION,
  tools,
  auth: { type: 'apiKey', requiredTokens: ['GITHUB_TOKEN'] },
  capabilities: ['pr', 'checks', 'comments']
});

const provider = {
  ...base,
  api: tools
} satisfies CIProvider;

export default provider;

