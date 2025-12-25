import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { config } from 'dotenv';
import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';

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

// Test issue: https://st.yandex-team.ru/CRM-46394
const TEST_ISSUE_ID = 'CRM-46394';
const TEST_ISSUE_URL = 'https://st.yandex-team.ru/CRM-46394';

// Load .env file from workspace root
const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
const envPath = path.join(workspaceRoot, '.env');
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

function hasTrackerToken(): boolean {
  return Boolean(process.env.TRACKER_TOKEN && process.env.TRACKER_TOKEN.trim());
}

async function getTrackerProvider(): Promise<any> {
  setProviderTypeSchema('issue-tracker', IssueTrackerProviderSchema);

  // Try to find ya-tracker module
  // Start from workspace root (where package.json is)
  const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();
  const possiblePaths = [
    path.resolve(process.cwd(), '..', 'devduck-ya-modules', 'modules', 'ya-tracker'), // projects/devduck -> projects/devduck-ya-modules
    path.resolve(workspaceRoot, 'projects', 'devduck-ya-modules', 'modules', 'ya-tracker'),
    path.resolve(workspaceRoot, 'devduck-ya-modules', 'modules', 'ya-tracker'),
    path.resolve(process.cwd(), '..', '..', 'devduck-ya-modules', 'modules', 'ya-tracker'),
    path.resolve(process.cwd(), '..', '..', '..', 'devduck-ya-modules', 'modules', 'ya-tracker'),
    path.resolve(process.cwd(), 'devduck-ya-modules', 'modules', 'ya-tracker')
  ];

  let trackerProviderPath: string | null = null;
  for (const candidate of possiblePaths) {
    const providerPath = path.join(candidate, 'providers', 'tracker-provider', 'index.ts');
    if (fs.existsSync(providerPath)) {
      trackerProviderPath = providerPath;
      break;
    }
  }

  if (!trackerProviderPath) {
    throw new Error(`tracker-provider not found. Searched in: ${possiblePaths.join(', ')}`);
  }

  // Import provider directly
  const providerModule = await import(pathToFileURL(trackerProviderPath).href);
  const provider = providerModule.default;

  // Validate provider
  const res = IssueTrackerProviderSchema.safeParse(provider);
  if (!res.success) {
    throw new Error(`Provider does not match schema: ${res.error.message}`);
  }

  return provider;
}

describe('ya-tracker: tracker-provider', () => {
  beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers tracker-provider from ya-tracker module and registers it', async () => {
    const provider = await getTrackerProvider();
    assert.ok(provider);
    assert.strictEqual(provider.manifest.type, 'issue-tracker');
    assert.strictEqual(provider.manifest.name, 'tracker-provider');
    assert.ok(Array.isArray(provider.manifest.tools));
    assert.ok(provider.manifest.tools.includes('fetchIssue'));
    assert.ok(provider.manifest.tools.includes('fetchComments'));
    assert.ok(provider.manifest.tools.includes('fetchPRs'));
    assert.ok(provider.manifest.tools.includes('downloadResources'));
  });

  test('matches IssueTrackerProvider contract schema', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const res = IssueTrackerProviderSchema.safeParse(provider);
    assert.ok(res.success, res.success ? '' : res.error.message);
  });

  test('fetchIssue returns issue that matches Issue schema', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const issue = await provider.fetchIssue({ issueId: TEST_ISSUE_ID });
    const parsed = IssueSchema.safeParse(issue);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(issue.id, TEST_ISSUE_ID);
    assert.strictEqual(issue.key, TEST_ISSUE_ID);
    assert.ok(typeof issue.title === 'string');
    assert.ok(issue.title.length > 0);
    assert.ok(typeof issue.description === 'string');
  });

  test('fetchIssue works with URL', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const issue = await provider.fetchIssue({ url: TEST_ISSUE_URL });
    assert.strictEqual(issue.id, TEST_ISSUE_ID);
    assert.strictEqual(issue.key, TEST_ISSUE_ID);
  });

  test('fetchComments returns comments that match Comment schema', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
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
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const prs = await provider.fetchPRs({ issueId: TEST_ISSUE_ID });
    assert.ok(Array.isArray(prs));
    for (const pr of prs) {
      const parsed = PRReferenceSchema.safeParse(pr);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof pr.id === 'string');
      assert.ok(typeof pr.title === 'string');
    }
  });

  test('downloadResources creates correct directory structure', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
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

  test('downloadResources downloads attachments via Tracker API', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, TEST_ISSUE_ID);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, TEST_ISSUE_ID);

    // Check for attachment resources
    const attachmentResources = Object.entries(resourcesJson).filter(
      ([, metadata]) => metadata.type === 'attachment'
    );

    if (attachmentResources.length > 0) {
      for (const [resourceId, metadata] of attachmentResources) {
        if (metadata.downloaded) {
          assert.ok(metadata.path, 'Attachment should have path');
          const filePath = path.join(resourcesDir, metadata.path);
          assert.ok(fs.existsSync(filePath), `Attachment file ${filePath} should exist`);
          assert.ok(typeof metadata.size === 'number' && metadata.size > 0, 'Attachment should have size');
        }
      }
    }

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources downloads Arcanum reviews via CI API', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, TEST_ISSUE_ID);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, TEST_ISSUE_ID);

    // Check for review resources
    const reviewResources = Object.entries(resourcesJson).filter(([, metadata]) =>
      metadata.source?.includes('a.yandex-team.ru/review/')
    );

    if (reviewResources.length > 0) {
      for (const [resourceId, metadata] of reviewResources) {
        if (metadata.downloaded) {
          assert.ok(metadata.path, 'Review should have path');
          assert.ok(metadata.path.endsWith('.json'), 'Review should be saved as JSON');
          const filePath = path.join(resourcesDir, metadata.path);
          assert.ok(fs.existsSync(filePath), `Review file ${filePath} should exist`);
        }
      }
    }

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });

  test('downloadResources downloads Arcadia files with correct extensions', async () => {
    if (!hasTrackerToken()) {
      return; // Skip test if token not set
    }

    const provider = await getTrackerProvider();
    const workspaceRoot = findWorkspaceRoot(process.cwd()) || process.cwd();

    await provider.downloadResources({ issueId: TEST_ISSUE_ID, maxDistance: 1 });

    const resourcesJson = readResourcesJson(workspaceRoot, TEST_ISSUE_ID);
    const resourcesDir = getIssueResourcesDir(workspaceRoot, TEST_ISSUE_ID);

    // Check for commit files (should have .diff extension)
    const commitResources = Object.entries(resourcesJson).filter(([, metadata]) =>
      metadata.source?.includes('/commit/')
    );

    for (const [resourceId, metadata] of commitResources) {
      if (metadata.downloaded && metadata.path) {
        if (metadata.source?.includes('/commit/')) {
          assert.ok(
            metadata.path.endsWith('.diff'),
            `Commit file ${metadata.path} should have .diff extension`
          );
        }
      }
    }

    // Check for source files (should have correct extensions like .ts, .tsx)
    const sourceFileResources = Object.entries(resourcesJson).filter(
      ([, metadata]) =>
        metadata.downloaded &&
        metadata.path &&
        (metadata.path.endsWith('.ts') || metadata.path.endsWith('.tsx') || metadata.path.endsWith('.js') || metadata.path.endsWith('.jsx'))
    );

    for (const [resourceId, metadata] of sourceFileResources) {
      const filePath = path.join(resourcesDir, metadata.path);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.length > 0, `Source file ${metadata.path} should have content`);
      }
    }

    // Cleanup
    const issueDir = getIssueCacheDir(workspaceRoot, TEST_ISSUE_ID);
    if (fs.existsSync(issueDir)) {
      fs.rmSync(issueDir, { recursive: true, force: true });
    }
  });
});

