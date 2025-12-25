import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type {
  IssueTrackerProvider,
  Issue,
  Comment,
  PRReference,
  FetchIssueInput,
  FetchCommentsInput,
  FetchPRsInput,
  DownloadResourcesInput,
  DownloadResourcesResult
} from '../../../issue-tracker/schemas/contract.js';
import { ISSUE_TRACKER_PROVIDER_PROTOCOL_VERSION } from '../../../issue-tracker/schemas/contract.js';
import {
  ensureIssueCacheDir,
  getWorkspaceRootOrThrow,
  updateResourceMetadata,
  saveResourceFile,
  readResourcesJson,
  writeResourcesJson,
  ensurePRCacheDir,
  cleanupResourcesDir
} from '../../../issue-tracker/scripts/resources.js';

interface RepoInfo {
  owner: string;
  repo: string;
}

interface GitHubIssue {
  id?: number;
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  html_url?: string;
  user?: { login?: string; id?: number; avatar_url?: string; name?: string };
  assignee?: { login?: string; id?: number; avatar_url?: string; name?: string } | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  pull_request?: { url?: string; html_url?: string };
  comments?: number;
  labels?: Array<{ name?: string; color?: string; description?: string }>;
}

interface GitHubComment {
  id?: number;
  body?: string;
  user?: { login?: string; id?: number; avatar_url?: string; name?: string };
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
}

interface GitHubPR {
  id?: number;
  number?: number;
  title?: string;
  html_url?: string;
  head?: { ref?: string };
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

function parseIssueUrl(url: string): { owner: string; repo: string; issueNumber: number } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/(?:issues|pull)\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2],
    issueNumber: Number.parseInt(match[3], 10)
  };
}

function parseIssueId(issueId: string): { owner: string; repo: string; issueNumber: number } | null {
  // Try to parse as "owner/repo#number" format
  const match1 = issueId.match(/^([^\/]+)\/([^#]+)#(\d+)$/);
  if (match1) {
    return {
      owner: match1[1],
      repo: match1[2],
      issueNumber: Number.parseInt(match1[3], 10)
    };
  }

  // Try to parse as just number (will need repo from context)
  const numMatch = issueId.match(/^#?(\d+)$/);
  if (numMatch) {
    const repoInfo = getRepoInfo();
    if (repoInfo) {
      return {
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        issueNumber: Number.parseInt(numMatch[1], 10)
      };
    }
  }

  return null;
}

function ensureOwnerRepoIssue(
  input: FetchIssueInput
): { owner: string; repo: string; issueNumber: number } {
  let parsed: { owner: string; repo: string; issueNumber: number } | null = null;

  if (input.url) {
    parsed = parseIssueUrl(input.url);
  } else if (input.issueId) {
    parsed = parseIssueId(input.issueId);
  }

  if (!parsed) {
    throw new Error(
      'github-provider: Could not parse issue URL or ID. Provide URL like https://github.com/owner/repo/issues/20 or ID like "owner/repo#20" or "#20" (in git repo).'
    );
  }

  return parsed;
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
      'User-Agent': 'devduck-github-provider'
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`github-provider: GitHub API error ${res.status} ${res.statusText}: ${body}`.trim());
  }

  return (await res.json()) as T;
}

function toContractIssue(ghIssue: GitHubIssue, owner: string, repo: string): Issue {
  const issueNumber = ghIssue.number || 0;
  if (!issueNumber) {
    throw new Error('github-provider: GitHub API returned an issue without number');
  }

  return {
    id: String(ghIssue.id || issueNumber),
    key: `#${issueNumber}`,
    title: ghIssue.title || '',
    description: ghIssue.body || '',
    status: ghIssue.state === 'open' ? 'open' : ghIssue.state === 'closed' ? 'closed' : undefined,
    state: ghIssue.state,
    url: ghIssue.html_url,
    author: ghIssue.user
      ? {
          id: String(ghIssue.user.id || ''),
          login: ghIssue.user.login || 'unknown',
          name: ghIssue.user.name,
          avatarUrl: ghIssue.user.avatar_url
        }
      : undefined,
    assignee: ghIssue.assignee
      ? {
          id: String(ghIssue.assignee.id || ''),
          login: ghIssue.assignee.login || 'unknown',
          name: ghIssue.assignee.name,
          avatarUrl: ghIssue.assignee.avatar_url
        }
      : undefined,
    createdAt: ghIssue.created_at,
    updatedAt: ghIssue.updated_at,
    closedAt: ghIssue.closed_at || undefined,
    labels: (ghIssue.labels || []).map((label) => ({
      name: label.name || '',
      color: label.color,
      description: label.description
    }))
  };
}

function toContractComment(ghComment: GitHubComment): Comment {
  const id = String(ghComment.id || '');
  if (!id) {
    throw new Error('github-provider: GitHub API returned a comment without id');
  }

  const reactions: Comment['reactions'] = [];
  if (ghComment.reactions) {
    if (ghComment.reactions['+1'] && ghComment.reactions['+1'] > 0) {
      reactions.push({ type: 'THUMBS_UP', count: ghComment.reactions['+1'], users: [] });
    }
    if (ghComment.reactions['-1'] && ghComment.reactions['-1'] > 0) {
      reactions.push({ type: 'THUMBS_DOWN', count: ghComment.reactions['-1'], users: [] });
    }
    if (ghComment.reactions.heart && ghComment.reactions.heart > 0) {
      reactions.push({ type: 'HEART', count: ghComment.reactions.heart, users: [] });
    }
    if (ghComment.reactions.laugh && ghComment.reactions.laugh > 0) {
      reactions.push({ type: 'LAUGH', count: ghComment.reactions.laugh, users: [] });
    }
    if (ghComment.reactions.hooray && ghComment.reactions.hooray > 0) {
      reactions.push({ type: 'HOORAY', count: ghComment.reactions.hooray, users: [] });
    }
    if (ghComment.reactions.rocket && ghComment.reactions.rocket > 0) {
      reactions.push({ type: 'ROCKET', count: ghComment.reactions.rocket, users: [] });
    }
    if (ghComment.reactions.eyes && ghComment.reactions.eyes > 0) {
      reactions.push({ type: 'EYES', count: ghComment.reactions.eyes, users: [] });
    }
  }

  return {
    id,
    body: ghComment.body || '',
    author: {
      id: String(ghComment.user?.id || ''),
      login: ghComment.user?.login || 'unknown',
      name: ghComment.user?.name,
      avatarUrl: ghComment.user?.avatar_url
    },
    createdAt: ghComment.created_at || new Date().toISOString(),
    updatedAt: ghComment.updated_at,
    reactions,
    url: ghComment.html_url
  };
}

function toContractPRReference(ghPR: GitHubPR): PRReference {
  const id = String(ghPR.id || ghPR.number || '');
  if (!id) {
    throw new Error('github-provider: GitHub API returned a PR without id or number');
  }

  return {
    id,
    number: ghPR.number,
    title: ghPR.title || '',
    url: ghPR.html_url,
    branch: ghPR.head?.ref
  };
}

/**
 * Extract URLs from text content
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s\)\]`"<>]+/g;
  const matches = text.match(urlRegex) || [];
  // Clean up URLs - remove trailing quotes, brackets, etc.
  return matches.map((url) => url.replace(/["')\]}>]+$/, '').trim());
}

/**
 * Discover resources from issue and comments
 */
function discoverResources(
  issue: Issue,
  comments: Comment[],
  distance: number
): Array<{
  id: string;
  url: string;
  type: 'json' | 'wiki' | 'ticket' | 'attachment' | 'url';
  description: string;
  distance: number;
}> {
  const resources: Array<{
    id: string;
    url: string;
    type: 'json' | 'wiki' | 'ticket' | 'attachment' | 'url';
    description: string;
    distance: number;
  }> = [];

  // Extract URLs from issue description
  const issueUrls = extractUrls(issue.description || '');
  for (const url of issueUrls) {
    let type: 'json' | 'wiki' | 'ticket' | 'attachment' | 'url' = 'url';
    let description = 'Linked resource';

    if (url.includes('github.com') && (url.includes('/issues/') || url.includes('/pull/'))) {
      type = 'ticket';
      description = 'Related GitHub issue or PR';
    } else if (url.match(/\.(png|jpg|jpeg|gif|svg|pdf|zip|tar\.gz)$/i)) {
      type = 'attachment';
      description = 'Attachment file';
    }

    resources.push({
      id: `resources/${url.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      url,
      type,
      description,
      distance
    });
  }

  // Extract URLs from comments
  for (const comment of comments) {
    const commentUrls = extractUrls(comment.body || '');
    for (const url of commentUrls) {
      let type: 'json' | 'wiki' | 'ticket' | 'attachment' | 'url' = 'url';
      let description = 'Linked resource from comment';

      if (url.includes('github.com') && (url.includes('/issues/') || url.includes('/pull/'))) {
        type = 'ticket';
        description = 'Related GitHub issue or PR from comment';
      } else if (url.match(/\.(png|jpg|jpeg|gif|svg|pdf|zip|tar\.gz)$/i)) {
        type = 'attachment';
        description = 'Attachment file from comment';
      }

      resources.push({
        id: `resources/${url.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        url,
        type,
        description,
        distance
      });
    }
  }

  return resources;
}

const provider: IssueTrackerProvider = {
  name: 'github-provider',
  version: '0.1.0',
  manifest: {
    type: 'issue-tracker',
    name: 'github-provider',
    version: '0.1.0',
    description: 'GitHub provider for issue tracker module (GitHub API)',
    protocolVersion: ISSUE_TRACKER_PROVIDER_PROTOCOL_VERSION,
    tools: ['fetchIssue', 'fetchComments', 'fetchPRs', 'downloadResources'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'apiKey', requiredTokens: ['GITHUB_TOKEN'] },
    capabilities: ['issues', 'comments', 'prs', 'resources']
  },

  async fetchIssue(input: FetchIssueInput): Promise<Issue> {
    const { owner, repo, issueNumber } = ensureOwnerRepoIssue(input);

    const ghIssue = await githubApiGet<GitHubIssue>(`repos/${owner}/${repo}/issues/${issueNumber}`);

    return toContractIssue(ghIssue, owner, repo);
  },

  async fetchComments(input: FetchCommentsInput): Promise<Comment[]> {
    const parsed = parseIssueId(input.issueId);
    if (!parsed) {
      throw new Error(`github-provider: Could not parse issue ID: ${input.issueId}`);
    }
    const { owner, repo, issueNumber } = parsed;

    const ghComments = await githubApiGet<GitHubComment[]>(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      per_page: 100
    });

    return ghComments.map(toContractComment);
  },

  async fetchPRs(input: FetchPRsInput): Promise<PRReference[]> {
    const parsed = parseIssueId(input.issueId);
    if (!parsed) {
      throw new Error(`github-provider: Could not parse issue ID: ${input.issueId}`);
    }
    const { owner, repo, issueNumber } = parsed;

    // First check if the issue itself is a PR
    const ghIssue = await githubApiGet<GitHubIssue>(`repos/${owner}/${repo}/issues/${issueNumber}`);
    const prs: PRReference[] = [];

    if (ghIssue.pull_request) {
      // Issue is a PR, return it as a PR reference
      const ghPR = await githubApiGet<GitHubPR>(`repos/${owner}/${repo}/pulls/${issueNumber}`);
      prs.push(toContractPRReference(ghPR));
    } else {
      // Search for PRs that reference this issue
      // GitHub automatically links PRs that mention issues, but we need to search
      // Look for PRs that mention this issue in the body or title
      try {
        const searchResults = await githubApiGet<{ items?: GitHubPR[] }>(
          `search/issues`,
          {
            q: `repo:${owner}/${repo} type:pr ${issueNumber}`,
            per_page: 10
          }
        );

        if (searchResults.items) {
          for (const item of searchResults.items) {
            // Get full PR details
            const ghPR = await githubApiGet<GitHubPR>(`repos/${owner}/${repo}/pulls/${item.number}`);
            prs.push(toContractPRReference(ghPR));
          }
        }
      } catch (error) {
        // Search API might fail, continue without PRs
        console.warn(`github-provider: Failed to search for PRs: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return prs;
  },

  async downloadResources(input: DownloadResourcesInput): Promise<DownloadResourcesResult> {
    const parsed = parseIssueId(input.issueId);
    if (!parsed) {
      throw new Error(`github-provider: Could not parse issue ID: ${input.issueId}`);
    }

    const workspaceRoot = getWorkspaceRootOrThrow();
    const { resourcesDir, resourcesJsonPath } = ensureIssueCacheDir(workspaceRoot, input.issueId);

    // Fetch issue and comments using the provider methods
    const issue = await provider.fetchIssue({ issueId: input.issueId });
    const comments = await provider.fetchComments({ issueId: input.issueId });

    // Discover resources
    const allResources = discoverResources(issue, comments, 0);

    // For distance > 0, we could discover from related issues, but for now keep it simple
    // and only process direct resources

    // Save main issue data
    const issueData = {
      ...issue,
      comments,
      prs: [] // Will be populated below
    };
    const issueJsonPath = saveResourceFile(resourcesDir, 'issue.json', JSON.stringify(issueData, null, 2));
    const issueSize = fs.statSync(issueJsonPath).size;

    updateResourceMetadata(workspaceRoot, input.issueId, 'resources/issue.json', {
      path: 'issue.json',
      indexedAt: new Date().toISOString(),
      lastUpdated: issue.updatedAt,
      type: 'json',
      description: 'Main issue data from GitHub API',
      size: issueSize,
      downloaded: true,
      distance: 0,
      source: issue.url || `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.issueNumber}`,
      httpStatus: 200
    });

    let downloadedCount = 1; // Issue JSON
    let trackedCount = 0;
    let errorCount = 0;

    // Process resources
    const resourcesJson = readResourcesJson(workspaceRoot, input.issueId);

    for (const resource of allResources) {
      // Skip if already processed
      if (resourcesJson[resource.id]) {
        continue;
      }

      const metadata: typeof resourcesJson[string] = {
        path: resource.id.startsWith('resources/') ? resource.id.substring('resources/'.length) : resource.id,
        indexedAt: new Date().toISOString(),
        type: resource.type,
        description: resource.description,
        downloaded: false,
        distance: resource.distance,
        source: resource.url
      };

      // Download resources with distance <= input.maxDistance
      if (resource.distance <= input.maxDistance) {
        try {
          // Download resource - follow redirects for GitHub user-attachments
          const headers: Record<string, string> = {
            'User-Agent': 'devduck-github-provider'
          };
          const token = process.env.GITHUB_TOKEN;
          if (token) {
            headers['Authorization'] = `token ${token}`;
          }
          const response = await fetch(resource.url, {
            headers,
            redirect: 'follow' // Follow redirects
          });

          metadata.httpStatus = response.status;

          if (response.ok) {
            const content = await response.arrayBuffer();
            const fileRelativePath = resource.id.startsWith('resources/')
              ? resource.id.substring('resources/'.length)
              : resource.id;
            saveResourceFile(resourcesDir, fileRelativePath, Buffer.from(content));
            const savedPath = path.join(resourcesDir, fileRelativePath);
            if (fs.existsSync(savedPath)) {
              metadata.size = fs.statSync(savedPath).size;
              metadata.downloaded = true;
              downloadedCount++;
            }
          } else {
            metadata.error = `HTTP ${response.status} ${response.statusText}`;
            errorCount++;
          }
        } catch (error) {
          metadata.error = error instanceof Error ? error.message : String(error);
          metadata.httpStatus = 500;
          errorCount++;
        }
      } else {
        // Track but don't download
        trackedCount++;
      }

      resourcesJson[resource.id] = metadata;
    }

    // Save resources.json
    writeResourcesJson(workspaceRoot, input.issueId, resourcesJson);

    // Clean up resources directory - move files not in resources.json to trash
    const movedCount = cleanupResourcesDir(workspaceRoot, input.issueId);

    // Handle PRs
    const prs = await provider.fetchPRs({ issueId: input.issueId });
    if (prs.length > 0) {
      // Create PR directories
      for (const pr of prs) {
        ensurePRCacheDir(workspaceRoot, pr.id);
      }

      // Update issue.json with PRs section
      const updatedIssueData = {
        ...issueData,
        prs: prs.map((pr) => ({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          branch: pr.branch,
          cachePath: `.cache/prs/${pr.id}`
        }))
      };
      saveResourceFile(resourcesDir, 'issue.json', JSON.stringify(updatedIssueData, null, 2));
    }

    return {
      issueId: input.issueId,
      resourcesPath: resourcesDir,
      resourcesJsonPath,
      downloadedCount,
      trackedCount,
      errorCount
    };
  }
};

export default provider;

