import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';

import provider from '../../modules/issue-tracker/providers/smogcheck-provider/index.ts';
import {
  IssueTrackerProviderSchema,
  IssueSchema,
  CommentSchema,
  PRReferenceSchema,
  DownloadResourcesResultSchema
} from '../../modules/issue-tracker/schemas/contract.ts';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType,
  setProviderTypeSchema
} from '../../scripts/lib/provider-registry.ts';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.ts';
import {
  getIssueCacheDir,
  getResourcesJsonPath,
  getIssueResourcesDir,
  readResourcesJson
} from '../../modules/issue-tracker/scripts/resources.ts';

test.describe('issue-tracker: smogcheck-provider', () => {
  test('matches IssueTrackerProvider contract schema', () => {
    const res = IssueTrackerProviderSchema.safeParse(provider);
    assert.ok(res.success, res.success ? '' : res.error.message);
    assert.strictEqual(provider.manifest.type, 'issue-tracker');
    assert.strictEqual(provider.manifest.name, 'smogcheck-provider');
    assert.ok(Array.isArray(provider.manifest.tools));
    assert.ok(provider.manifest.tools.includes('fetchIssue'));
    assert.ok(provider.manifest.tools.includes('fetchComments'));
    assert.ok(provider.manifest.tools.includes('fetchPRs'));
    assert.ok(provider.manifest.tools.includes('downloadResources'));
  });

  test('fetchIssue returns issue that matches Issue schema', async () => {
    const issue = await provider.fetchIssue({ issueId: 'issue-1' });
    const parsed = IssueSchema.safeParse(issue);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(issue.id, 'issue-1');
    assert.strictEqual(issue.key, 'TEST-1');
    assert.ok(typeof issue.title === 'string');
    assert.ok(typeof issue.description === 'string');
  });

  test('fetchIssue works with issue key', async () => {
    const issue = await provider.fetchIssue({ issueId: 'TEST-1' });
    assert.strictEqual(issue.key, 'TEST-1');
  });

  test('fetchIssue works with URL', async () => {
    const issue = await provider.fetchIssue({ url: 'https://smogcheck.local/issues/1' });
    assert.strictEqual(issue.id, 'issue-1');
  });

  test('fetchIssue throws error for non-existent issue', async () => {
    try {
      await provider.fetchIssue({ issueId: 'non-existent' });
      assert.fail('Expected error for non-existent issue');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not found'));
    }
  });

  test('fetchComments returns comments that match Comment schema', async () => {
    const comments = await provider.fetchComments({ issueId: 'issue-1' });
    assert.ok(Array.isArray(comments));
    assert.ok(comments.length > 0);
    for (const comment of comments) {
      const parsed = CommentSchema.safeParse(comment);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof comment.id === 'string');
      assert.ok(typeof comment.body === 'string');
      assert.ok(comment.author);
      assert.ok(typeof comment.author.login === 'string');
    }
  });

  test('fetchComments includes reactions', async () => {
    const comments = await provider.fetchComments({ issueId: 'issue-1' });
    const commentWithReactions = comments.find((c) => c.reactions && c.reactions.length > 0);
    assert.ok(commentWithReactions, 'Expected at least one comment with reactions');
    assert.ok(Array.isArray(commentWithReactions.reactions));
    assert.ok(commentWithReactions.reactions.length > 0);
  });

  test('fetchComments returns empty array for issue without comments', async () => {
    const comments = await provider.fetchComments({ issueId: 'issue-3' });
    assert.ok(Array.isArray(comments));
    assert.strictEqual(comments.length, 0);
  });

  test('fetchPRs returns PR references that match PRReference schema', async () => {
    const prs = await provider.fetchPRs({ issueId: 'issue-1' });
    assert.ok(Array.isArray(prs));
    assert.ok(prs.length > 0);
    for (const pr of prs) {
      const parsed = PRReferenceSchema.safeParse(pr);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof pr.id === 'string');
      assert.ok(typeof pr.title === 'string');
    }
  });

  test('fetchPRs returns empty array for issue without PRs', async () => {
    const prs = await provider.fetchPRs({ issueId: 'issue-3' });
    assert.ok(Array.isArray(prs));
    assert.strictEqual(prs.length, 0);
  });

  test('downloadResources creates correct directory structure', async () => {
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    const issueId = 'issue-1';
    const result = await provider.downloadResources({ issueId, maxDistance: 2 });

    const parsed = DownloadResourcesResultSchema.safeParse(result);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(result.issueId, issueId);
    assert.ok(typeof result.resourcesPath === 'string');
    assert.ok(typeof result.resourcesJsonPath === 'string');
    assert.ok(result.downloadedCount > 0);

    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);
    const resourcesJsonPath = getResourcesJsonPath(workspaceRoot, issueId);

    assert.ok(fs.existsSync(issueDir), 'Issue directory should exist');
    assert.ok(fs.existsSync(resourcesDir), 'Resources directory should exist');
    assert.ok(fs.existsSync(resourcesJsonPath), 'resources.json should exist');
    assert.strictEqual(result.resourcesPath, resourcesDir);
    assert.strictEqual(result.resourcesJsonPath, resourcesJsonPath);

    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources creates resources.json with correct metadata', async () => {
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
    const issueId = 'issue-1';
    await provider.downloadResources({ issueId, maxDistance: 2 });

    const resourcesJson = readResourcesJson(workspaceRoot, issueId);

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

    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources downloads resources with distance <= 2', async () => {
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
    const issueId = 'issue-1';
    await provider.downloadResources({ issueId, maxDistance: 2 });

    const resourcesJson = readResourcesJson(workspaceRoot, issueId);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);

    for (const [resourceId, metadata] of Object.entries(resourcesJson)) {
      if (metadata.distance <= 2) {
        assert.strictEqual(
          metadata.downloaded,
          true,
          `Resource ${resourceId} with distance ${metadata.distance} should be downloaded`
        );
        const filePath = path.join(resourcesDir, metadata.path);
        assert.ok(fs.existsSync(filePath), `Resource file ${filePath} should exist`);
      }
    }

    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources tracks resources with distance == 3 without downloading', async () => {
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
    const issueId = 'issue-1';
    await provider.downloadResources({ issueId, maxDistance: 3 });

    const resourcesJson = readResourcesJson(workspaceRoot, issueId);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);

    for (const [resourceId, metadata] of Object.entries(resourcesJson)) {
      if (metadata.distance === 3) {
        assert.strictEqual(metadata.downloaded, false, `Resource ${resourceId} with distance 3 should not be downloaded`);
        const filePath = path.join(resourcesDir, metadata.path);
        assert.ok(!fs.existsSync(filePath), `Resource file ${filePath} should not exist`);
      }
    }

    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources creates issue.json with comments and PRs', async () => {
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
    const issueId = 'issue-1';
    await provider.downloadResources({ issueId, maxDistance: 2 });

    const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);
    const issueJsonPath = path.join(resourcesDir, 'issue.json');

    assert.ok(fs.existsSync(issueJsonPath), 'issue.json should exist');

    const issueData = JSON.parse(fs.readFileSync(issueJsonPath, 'utf8'));
    assert.ok(issueData.comments, 'issue.json should have comments');
    assert.ok(Array.isArray(issueData.comments));
    assert.ok(issueData.comments.length > 0);

    if (issueData.prs) {
      assert.ok(Array.isArray(issueData.prs));
      for (const pr of issueData.prs) {
        assert.ok(typeof pr.id === 'string');
        assert.ok(pr.url);
        assert.ok(pr.cachePath);
      }
    }

    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources creates PR directories when PRs exist', async () => {
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
    const issueId = 'issue-1';
    await provider.downloadResources({ issueId, maxDistance: 2 });

    const prs = await provider.fetchPRs({ issueId });
    if (prs.length > 0) {
      const prsDir = path.join(workspaceRoot, '.cache', 'prs');
      for (const pr of prs) {
        const prDir = path.join(prsDir, pr.id);
        assert.ok(fs.existsSync(prDir), `PR directory ${prDir} should exist`);
      }

      if (fs.existsSync(prsDir)) {
        fs.rmSync(prsDir, { recursive: true, force: true });
      }
    }

    const issueDir = getIssueCacheDir(workspaceRoot, issueId);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });
});

test.describe('issue-tracker: provider registry discovery', () => {
  test.beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers smogcheck-provider from modules directory and registers it (with schema validation)', async () => {
    setProviderTypeSchema('issue-tracker', IssueTrackerProviderSchema);

    const modulesDir = path.resolve(process.cwd(), 'modules');
    await discoverProvidersFromModules({ modulesDir });

    const providers = getProvidersByType('issue-tracker');
    assert.ok(providers.some((p) => p.name === 'smogcheck-provider'));

    const p = getProvider('issue-tracker', 'smogcheck-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'issue-tracker');
  });
});

