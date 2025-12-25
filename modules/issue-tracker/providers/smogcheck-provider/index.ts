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
} from '../../schemas/contract.js';
import { ISSUE_TRACKER_PROVIDER_PROTOCOL_VERSION } from '../../schemas/contract.js';
import {
  ensureIssueCacheDir,
  getWorkspaceRootOrThrow,
  updateResourceMetadata,
  saveResourceFile,
  readResourcesJson,
  writeResourcesJson,
  ensurePRCacheDir,
  cleanupResourcesDir
} from '../../scripts/resources.js';

function nowMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

const MOCK_ISSUES: Issue[] = [
  {
    id: 'issue-1',
    key: 'TEST-1',
    title: 'Implement new feature',
    description: 'This is a test issue for implementing a new feature.\n\nSee related: TEST-2\nWiki: https://wiki.example.com/feature-guide',
    status: 'open',
    state: 'open',
    url: 'https://smogcheck.local/issues/1',
    author: {
      id: 'author-1',
      login: 'alice',
      name: 'Alice Smith',
      avatarUrl: 'https://smogcheck.local/avatars/alice.png'
    },
    assignee: {
      id: 'assignee-1',
      login: 'bob',
      name: 'Bob Johnson',
      avatarUrl: 'https://smogcheck.local/avatars/bob.png'
    },
    createdAt: nowMinusDays(5),
    updatedAt: nowMinusDays(1),
    labels: [
      { name: 'feature', color: '0e8a16', description: 'New feature' },
      { name: 'enhancement', color: 'a2eeef' }
    ]
  },
  {
    id: 'issue-2',
    key: 'TEST-2',
    title: 'Related issue',
    description: 'This is a related issue linked from TEST-1.',
    status: 'open',
    state: 'open',
    url: 'https://smogcheck.local/issues/2',
    author: {
      id: 'author-2',
      login: 'charlie',
      name: 'Charlie Brown'
    },
    createdAt: nowMinusDays(3),
    updatedAt: nowMinusDays(2),
    labels: [
      { name: 'bug', color: 'd73a4a' }
    ]
  },
  {
    id: 'issue-3',
    key: 'TEST-3',
    title: 'Deep linked issue',
    description: 'This issue is linked from TEST-2 (distance 2 from TEST-1).',
    status: 'closed',
    state: 'closed',
    url: 'https://smogcheck.local/issues/3',
    author: {
      id: 'author-3',
      login: 'dave',
      name: 'Dave Wilson'
    },
    createdAt: nowMinusDays(10),
    updatedAt: nowMinusDays(8),
    closedAt: nowMinusDays(7),
    labels: [
      { name: 'documentation', color: '0075ca' }
    ]
  }
];

const MOCK_COMMENTS: Record<string, Comment[]> = {
  'issue-1': [
    {
      id: 'comment-1',
      body: 'This looks good, let me review the implementation.',
      author: {
        id: 'reviewer-1',
        login: 'alice',
        name: 'Alice Smith',
        avatarUrl: 'https://smogcheck.local/avatars/alice.png'
      },
      createdAt: nowMinusDays(4),
      updatedAt: nowMinusDays(4),
      reactions: [
        {
          type: 'THUMBS_UP',
          count: 2,
          users: ['bob', 'charlie']
        }
      ],
      url: 'https://smogcheck.local/issues/1/comments/comment-1'
    },
    {
      id: 'comment-2',
      body: 'I found a bug in the implementation. See TEST-2 for details.',
      author: {
        id: 'reviewer-2',
        login: 'bob',
        name: 'Bob Johnson'
      },
      createdAt: nowMinusDays(2),
      reactions: [
        {
          type: 'HEART',
          count: 1,
          users: ['alice']
        }
      ],
      url: 'https://smogcheck.local/issues/1/comments/comment-2'
    }
  ],
  'issue-2': [
    {
      id: 'comment-3',
      body: 'This is a comment on the related issue.',
      author: {
        id: 'author-2',
        login: 'charlie',
        name: 'Charlie Brown'
      },
      createdAt: nowMinusDays(1),
      url: 'https://smogcheck.local/issues/2/comments/comment-3'
    }
  ]
};

const MOCK_PRS: Record<string, PRReference[]> = {
  'issue-1': [
    {
      id: 'pr-1',
      number: 123,
      title: 'PR for issue TEST-1',
      url: 'https://smogcheck.local/pr/123',
      branch: 'feature/test-1'
    },
    {
      id: 'pr-2',
      number: 124,
      title: 'Alternative implementation for TEST-1',
      url: 'https://smogcheck.local/pr/124',
      branch: 'feature/test-1-alt'
    }
  ],
  'issue-2': [
    {
      id: 'pr-3',
      number: 125,
      title: 'PR for issue TEST-2',
      url: 'https://smogcheck.local/pr/125',
      branch: 'fix/test-2'
    }
  ]
};

function findIssueById(issueId: string): Issue | null {
  return MOCK_ISSUES.find((issue) => issue.id === issueId || issue.key === issueId) || null;
}

function findIssueByUrl(url: string): Issue | null {
  // Extract issue ID from URL
  const match = url.match(/issues\/(\d+)/);
  if (match) {
    const issueNum = match[1];
    return MOCK_ISSUES.find((issue) => issue.id === `issue-${issueNum}`) || null;
  }
  return null;
}

/**
 * Parse URLs from text content
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s\)]+/g;
  return text.match(urlRegex) || [];
}

/**
 * Discover resources from issue and comments
 */
function discoverResources(issue: Issue, comments: Comment[], distance: number): Array<{
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

    if (url.includes('wiki.')) {
      type = 'wiki';
      description = 'Wiki page';
    } else if (url.includes('/issues/') || url.includes('/TEST-')) {
      type = 'ticket';
      description = 'Related issue';
    } else if (url.includes('/attachments/')) {
      type = 'attachment';
      description = 'Attachment';
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

      if (url.includes('wiki.')) {
        type = 'wiki';
        description = 'Wiki page from comment';
      } else if (url.includes('/issues/') || url.includes('/TEST-')) {
        type = 'ticket';
        description = 'Related issue from comment';
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
  name: 'smogcheck-provider',
  version: '0.1.0',
  manifest: {
    type: 'issue-tracker',
    name: 'smogcheck-provider',
    version: '0.1.0',
    description: 'Test provider for issue tracker module',
    protocolVersion: ISSUE_TRACKER_PROVIDER_PROTOCOL_VERSION,
    tools: ['fetchIssue', 'fetchComments', 'fetchPRs', 'downloadResources'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'none', requiredTokens: [] },
    capabilities: ['issues', 'comments', 'prs', 'resources']
  },

  async fetchIssue(input: FetchIssueInput): Promise<Issue> {
    let issue: Issue | null = null;

    if (input.issueId) {
      issue = findIssueById(input.issueId);
    } else if (input.url) {
      issue = findIssueByUrl(input.url);
    }

    if (!issue) {
      throw new Error(`Issue not found: ${input.issueId || input.url || 'unknown'}`);
    }

    return issue;
  },

  async fetchComments(input: FetchCommentsInput): Promise<Comment[]> {
    const issue = findIssueById(input.issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${input.issueId}`);
    }

    return MOCK_COMMENTS[issue.id] || [];
  },

  async fetchPRs(input: FetchPRsInput): Promise<PRReference[]> {
    const issue = findIssueById(input.issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${input.issueId}`);
    }

    return MOCK_PRS[issue.id] || [];
  },

  async downloadResources(input: DownloadResourcesInput): Promise<DownloadResourcesResult> {
    const issue = findIssueById(input.issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${input.issueId}`);
    }

    const workspaceRoot = getWorkspaceRootOrThrow();
    const { resourcesDir, resourcesJsonPath } = ensureIssueCacheDir(workspaceRoot, input.issueId);

    // Fetch comments for resource discovery
    const comments = await this.fetchComments({ issueId: input.issueId });

    // Discover resources
    const allResources = discoverResources(issue, comments, 0);

    // For distance > 0, discover from related issues
    if (input.maxDistance >= 1) {
      // Find related issues mentioned in description/comments
      const relatedIssueKeys = [
        ...(issue.description?.match(/TEST-\d+/g) || []),
        ...comments.flatMap((c) => c.body?.match(/TEST-\d+/g) || [])
      ];
      const uniqueKeys = [...new Set(relatedIssueKeys)];

      for (const key of uniqueKeys) {
        const relatedIssue = findIssueById(key);
        if (relatedIssue) {
          const relatedComments = MOCK_COMMENTS[relatedIssue.id] || [];
          const relatedResources = discoverResources(relatedIssue, relatedComments, 1);
          allResources.push(...relatedResources);

          // Distance 2: find issues linked from related issues
          if (input.maxDistance >= 2) {
            const deepIssueKeys = [
              ...(relatedIssue.description?.match(/TEST-\d+/g) || []),
              ...relatedComments.flatMap((c) => c.body?.match(/TEST-\d+/g) || [])
            ];
            const deepUniqueKeys = [...new Set(deepIssueKeys)];

            for (const deepKey of deepUniqueKeys) {
              const deepIssue = findIssueById(deepKey);
              if (deepIssue && deepIssue.id !== issue.id && deepIssue.id !== relatedIssue.id) {
                const deepComments = MOCK_COMMENTS[deepIssue.id] || [];
                const deepResources = discoverResources(deepIssue, deepComments, 2);
                allResources.push(...deepResources);

                // Distance 3: track but don't download
                if (input.maxDistance >= 3) {
                  const distance3Keys = [
                    ...(deepIssue.description?.match(/TEST-\d+/g) || []),
                    ...deepComments.flatMap((c) => c.body?.match(/TEST-\d+/g) || [])
                  ];
                  const distance3UniqueKeys = [...new Set(distance3Keys)];

                  for (const d3Key of distance3UniqueKeys) {
                    const d3Issue = findIssueById(d3Key);
                    if (d3Issue && !allResources.some((r) => r.url.includes(d3Issue.id))) {
                      allResources.push({
                        id: `resources/${d3Issue.key || d3Issue.id}.json`,
                        url: d3Issue.url || `https://smogcheck.local/issues/${d3Issue.id}`,
                        type: 'ticket',
                        description: `Related issue ${d3Issue.key || d3Issue.id}`,
                        distance: 3
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Save main issue data
    const issueData = {
      ...issue,
      comments
    };
    const issueJsonPath = saveResourceFile(resourcesDir, 'issue.json', JSON.stringify(issueData, null, 2));
    const issueSize = fs.statSync(issueJsonPath).size;

    updateResourceMetadata(workspaceRoot, input.issueId, 'resources/issue.json', {
      path: 'issue.json',
      indexedAt: new Date().toISOString(),
      lastUpdated: issue.updatedAt,
      type: 'json',
      description: 'Main issue data from API',
      size: issueSize,
      downloaded: true,
      distance: 0,
      source: issue.url || `https://smogcheck.local/issues/${issue.id}`,
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
        path: resource.id,
        indexedAt: new Date().toISOString(),
        type: resource.type,
        description: resource.description,
        downloaded: false,
        distance: resource.distance,
        source: resource.url
      };

      // Download resources with distance <= 2
      if (resource.distance <= 2) {
        try {
          // Simulate downloading resource
          let content: string;
          if (resource.type === 'ticket') {
            // For tickets, save as JSON
            const ticketIssue = findIssueById(resource.url.match(/TEST-\d+/)?.[0] || '');
            if (ticketIssue) {
              content = JSON.stringify(ticketIssue, null, 2);
              metadata.ticketKey = ticketIssue.key;
              metadata.lastUpdated = ticketIssue.updatedAt;
            } else {
              content = JSON.stringify({ url: resource.url, type: 'ticket' }, null, 2);
            }
          } else if (resource.type === 'wiki') {
            // For wiki, save as markdown
            content = `# Wiki Page\n\nContent from ${resource.url}\n\nThis is a mock wiki page.`;
          } else {
            // For other types, save URL reference
            content = JSON.stringify({ url: resource.url, type: resource.type }, null, 2);
          }

          // Strip 'resources/' prefix from resource.id for file path
          const fileRelativePath = resource.id.startsWith('resources/') 
            ? resource.id.substring('resources/'.length)
            : resource.id;
          const savedPath = saveResourceFile(resourcesDir, fileRelativePath, content);
          if (fs.existsSync(savedPath)) {
            metadata.size = fs.statSync(savedPath).size;
            metadata.path = fileRelativePath; // Store relative path without 'resources/' prefix
            metadata.downloaded = true;
            metadata.httpStatus = 200;
            downloadedCount++;
          }
        } catch (error) {
          metadata.error = error instanceof Error ? error.message : String(error);
          metadata.httpStatus = 500;
          errorCount++;
        }
      } else {
        // Track but don't download (distance == 3)
        trackedCount++;
      }

      resourcesJson[resource.id] = metadata;
    }

    // Save resources.json
    writeResourcesJson(workspaceRoot, input.issueId, resourcesJson);

    // Clean up resources directory - move files not in resources.json to trash
    const movedCount = cleanupResourcesDir(workspaceRoot, input.issueId);

    // Handle PRs
    const prs = await this.fetchPRs({ issueId: input.issueId });
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

