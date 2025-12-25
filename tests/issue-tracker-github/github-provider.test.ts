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
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';
import {
  getIssueCacheDir,
  getResourcesJsonPath,
  getIssueResourcesDir,
  readResourcesJson
} from '../../modules/issue-tracker/scripts/resources.js';

// Test issue: https://github.com/holiber/devduck/issues/20
const TEST_ISSUE_ID = 'holiber/devduck#20';
const TEST_ISSUE_URL = 'https://github.com/holiber/devduck/issues/20';

// Load .env file from workspace root
const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
const envPath = path.join(workspaceRoot, '.env');
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

function hasGitHubToken(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim());
}

describe('issue-tracker-github: github-provider', () => {
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

  test('fetchIssue returns issue that matches Issue schema', async () => {
    if (!hasGitHubToken()) {
      return; // Skip test if token not set
    }

    const issue = await provider.fetchIssue({ issueId: TEST_ISSUE_ID });
    const parsed = IssueSchema.safeParse(issue);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.ok(issue.id);
    assert.ok(issue.key);
    assert.ok(typeof issue.title === 'string');
    assert.ok(issue.title.length > 0);
    assert.ok(typeof issue.description === 'string');
  });

  test('fetchIssue works with URL', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const issue = await provider.fetchIssue({ url: TEST_ISSUE_URL });
    assert.ok(issue.id);
    assert.ok(issue.key);
    assert.ok(issue.title.includes('issue tracker') || issue.title.includes('Issue tracker'));
  });

  test('fetchIssue throws error for non-existent issue', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    try {
      await provider.fetchIssue({ issueId: 'holiber/devduck#999999' });
      assert.fail('Expected error for non-existent issue');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not found') || error.message.includes('404'));
    }
  });

  test('fetchComments returns comments that match Comment schema', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const comments = await provider.fetchComments({ issueId: TEST_ISSUE_ID });
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

  test('fetchPRs returns PR references that match PRReference schema', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const prs = await provider.fetchPRs({ issueId: TEST_ISSUE_ID });
    assert.ok(Array.isArray(prs));
    for (const pr of prs) {
      const parsed = PRReferenceSchema.safeParse(pr);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof pr.id === 'string');
      assert.ok(typeof pr.title === 'string');
      assert.ok(typeof pr.url === 'string');
    }
  });

  test('downloadResources creates correct directory structure', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    const result = await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    // Verify result matches schema
    const parsed = DownloadResourcesResultSchema.safeParse(result);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(result.issueId, TEST_ISSUE_ID);
    assert.ok(typeof result.resourcesPath === 'string');
    assert.ok(typeof result.resourcesJsonPath === 'string');
    assert.ok(result.downloadedCount > 0);

    // Verify directories exist
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, TEST_ISSUE_ID);
    const resourcesJsonPath = getResourcesJsonPath(workspaceRoot, TEST_ISSUE_ID);

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

  test('downloadResources creates resources.json with correct metadata', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, TEST_ISSUE_ID);

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
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources downloads resources with distance <= 1', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, TEST_ISSUE_ID);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, TEST_ISSUE_ID);

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
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources creates issue.json with comments', async () => {
    if (!hasGitHubToken()) {
      test.skip('GITHUB_TOKEN not set');
      return;
    }

    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    const resourcesDir = getIssueResourcesDir(workspaceRoot, TEST_ISSUE_ID);
    const issueJsonPath = path.join(resourcesDir, 'issue.json');

    assert.ok(fs.existsSync(issueJsonPath), 'issue.json should exist');

    const issueData = JSON.parse(fs.readFileSync(issueJsonPath, 'utf8'));
    assert.ok(issueData.comments, 'issue.json should have comments');
    assert.ok(Array.isArray(issueData.comments));

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
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

