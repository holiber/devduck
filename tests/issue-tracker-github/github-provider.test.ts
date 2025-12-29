import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs';
import { config } from 'dotenv';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';

import provider from '../../modules/issue-tracker-github/providers/github-provider/index.js';
import {
  IssueTrackerProviderSchema,
  IssueSchema,
  CommentSchema,
  PRReferenceSchema,
  DownloadResourcesResultSchema
} from '../../modules/issue-tracker/schemas/contract.js';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType,
  setProviderTypeSchema
} from '../../scripts/lib/provider-registry.js';
import {
  getIssueCacheDir,
  getResourcesJsonPath,
  getIssueResourcesDir,
  readResourcesJson
} from '../../modules/issue-tracker/scripts/resources.js';

const TEST_ISSUE_ID = (process.env.GITHUB_TEST_ISSUE_ID || '').trim();
const TEST_ISSUE_URL = (process.env.GITHUB_TEST_ISSUE_URL || '').trim();

// Load .env file from workspace root
const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
const envPath = path.join(workspaceRoot, '.env');
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

function hasGitHubToken(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim());
}

function parseIssueId(issueId: string): { owner: string; repo: string; number: string } | null {
  const m = issueId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: m[3] };
}

function parseIssueUrl(url: string): { owner: string; repo: string; number: string } | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: m[3] };
}

function getTestIssueId(): string | null {
  if (TEST_ISSUE_ID) return TEST_ISSUE_ID;
  if (TEST_ISSUE_URL) {
    const p = parseIssueUrl(TEST_ISSUE_URL);
    if (p) return `${p.owner}/${p.repo}#${p.number}`;
  }
  return null;
}

function getTestIssueUrl(issueId: string): string | null {
  if (TEST_ISSUE_URL) return TEST_ISSUE_URL;
  const p = parseIssueId(issueId);
  if (!p) return null;
  return `https://github.com/${p.owner}/${p.repo}/issues/${p.number}`;
}

function getNonExistentIssueId(issueId: string): string {
  const p = parseIssueId(issueId);
  if (!p) return `${issueId}#999999`;
  return `${p.owner}/${p.repo}#999999`;
}

describe('issue-tracker-github: github-provider', () => {
  const testIssueId = getTestIssueId();
  const shouldRunGitHubTests = hasGitHubToken() && Boolean(testIssueId);

  test('matches IssueTrackerProvider contract schema', () => {
    const res = IssueTrackerProviderSchema.safeParse(provider);
    assert.ok(res.success, res.success ? '' : res.error.message);
    assert.strictEqual(provider.manifest.type, 'issue-tracker');
    assert.strictEqual(provider.manifest.name, 'github-provider');
    assert.ok(Array.isArray(provider.manifest.tools));
    assert.ok(provider.manifest.tools.includes('fetchIssue'));
    assert.ok(provider.manifest.tools.includes('fetchComments'));
    assert.ok(provider.manifest.tools.includes('fetchPRs'));
    assert.ok(provider.manifest.tools.includes('downloadResources'));
  });

  test(
    'fetchIssue returns issue that matches Issue schema',
    { skip: !shouldRunGitHubTests },
    async () => {
      const issueId = testIssueId as string;

      const issue = await provider.fetchIssue({ issueId });
      const parsed = IssueSchema.safeParse(issue);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(issue.id);
      assert.ok(issue.key);
      assert.ok(typeof issue.title === 'string');
      assert.ok(issue.title.length > 0);
      assert.ok(typeof issue.description === 'string');
    }
  );

  test('fetchIssue works with URL', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;
    const url = getTestIssueUrl(issueId);
    assert.ok(url, 'Test issue URL must be provided via GITHUB_TEST_ISSUE_URL or derived from GITHUB_TEST_ISSUE_ID');

    const issue = await provider.fetchIssue({ url });
    assert.ok(issue.id);
    assert.ok(issue.key);
  });

  test('fetchIssue throws error for non-existent issue', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    try {
      await provider.fetchIssue({ issueId: getNonExistentIssueId(issueId) });
      assert.fail('Expected error for non-existent issue');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not found') || error.message.includes('404'));
    }
  });

  test('fetchComments returns comments that match Comment schema', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    const comments = await provider.fetchComments({ issueId });
    assert.ok(Array.isArray(comments));
    for (const comment of comments) {
      const parsed = CommentSchema.safeParse(comment);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof comment.id === 'string');
      assert.ok(typeof comment.body === 'string');
      assert.ok(comment.author);
      assert.ok(typeof comment.author.login === 'string');
      assert.ok(typeof comment.createdAt === 'string');
    }
  });

  test('fetchPRs returns PR references that match PRReference schema', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    const prs = await provider.fetchPRs({ issueId });
    assert.ok(Array.isArray(prs));
    for (const pr of prs) {
      const parsed = PRReferenceSchema.safeParse(pr);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof pr.id === 'string');
      assert.ok(typeof pr.title === 'string');
      assert.ok(typeof pr.url === 'string');
    }
  });

  test('downloadResources creates correct directory structure', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    const result = await provider.downloadResources({ issueId, maxDistance: 1 });

    // Verify result matches schema
    const parsed = DownloadResourcesResultSchema.safeParse(result);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(result.issueId, issueId);
    assert.ok(typeof result.resourcesPath === 'string');
    assert.ok(typeof result.resourcesJsonPath === 'string');
    assert.ok(result.downloadedCount > 0);

    // Verify directories exist
    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);
    const resourcesJsonPath = getResourcesJsonPath(workspaceRoot, issueId);

    assert.ok(fs.existsSync(issueDir), 'Issue directory should exist');
    assert.ok(fs.existsSync(resourcesDir), 'Resources directory should exist');
    assert.ok(fs.existsSync(resourcesJsonPath), 'resources.json should exist');
    assert.strictEqual(result.resourcesPath, resourcesDir);
    assert.strictEqual(result.resourcesJsonPath, resourcesJsonPath);

    // Cleanup
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources creates resources.json with correct metadata', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, issueId);

    // Verify resources.json structure
    assert.ok(typeof resourcesJson === 'object');
    assert.ok('resources/issue.json' in resourcesJson, 'Should have issue.json entry');

    const issueMetadata = resourcesJson['resources/issue.json'];
    assert.ok(issueMetadata);
    assert.strictEqual(issueMetadata.path, 'issue.json');
    assert.strictEqual(issueMetadata.type, 'json');
    assert.strictEqual(issueMetadata.distance, 0);
    assert.strictEqual(issueMetadata.downloaded, true);
    assert.ok(typeof issueMetadata.indexedAt === 'string');
    assert.ok(typeof issueMetadata.size === 'number');

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources downloads resources with distance <= 1', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, issueId);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);

    // Check that resources with distance <= 1 are downloaded
    for (const [resourceId, metadata] of Object.entries(resourcesJson)) {
      if (metadata.distance <= 1) {
        assert.strictEqual(
          metadata.downloaded,
          true,
          `Resource ${resourceId} with distance ${metadata.distance} should be downloaded`
        );
        // metadata.path is relative to resources directory (no 'resources/' prefix)
        const filePath = path.join(resourcesDir, metadata.path);
        assert.ok(fs.existsSync(filePath), `Resource file ${filePath} should exist`);
      }
    }

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources creates issue.json with comments', { skip: !shouldRunGitHubTests }, async () => {
    const issueId = testIssueId as string;

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId, maxDistance: 1 });

    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);
    const issueJsonPath = path.join(resourcesDir, 'issue.json');

    assert.ok(fs.existsSync(issueJsonPath), 'issue.json should exist');

    const issueData = JSON.parse(fs.readFileSync(issueJsonPath, 'utf8'));
    assert.ok(issueData.comments, 'issue.json should have comments');
    assert.ok(Array.isArray(issueData.comments));

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });
});

describe('issue-tracker-github: provider registry discovery', () => {
  beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers github-provider from modules directory and registers it (with schema validation)', async () => {
    setProviderTypeSchema('issue-tracker', IssueTrackerProviderSchema);

    const modulesDir = path.resolve(process.cwd(), 'modules');
    await discoverProvidersFromModules({ modulesDir });

    const providers = getProvidersByType('issue-tracker');
    assert.ok(providers.some((p) => p.name === 'github-provider'));

    const p = getProvider('issue-tracker', 'github-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'issue-tracker');
  });
});

