import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import provider from '../../modules/ci/providers/smogcheck-provider/index.js';
import {
  CIProviderSchema,
  PRInfoSchema,
  CheckStatusSchema,
  CommentSchema
} from '../../modules/ci/schemas/contract.js';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType,
  setProviderTypeSchema
} from '../../scripts/lib/provider-registry.js';

describe('ci: smogcheck-provider', () => {
  test('matches CIProvider contract schema', () => {
    const res = CIProviderSchema.safeParse(provider);
    assert.ok(res.success, res.success ? '' : res.error.message);
    assert.strictEqual(provider.manifest.type, 'ci');
    assert.strictEqual(provider.manifest.name, 'smogcheck-provider');
    assert.ok(Array.isArray(provider.manifest.tools));
    assert.ok(provider.manifest.tools.includes('fetchPR'));
    assert.ok(provider.manifest.tools.includes('fetchCheckStatus'));
    assert.ok(provider.manifest.tools.includes('fetchComments'));
  });

  test('fetchPR returns PR info that matches PRInfo schema', async () => {
    const pr = await provider.fetchPR({ prId: 'pr-1' });
    const parsed = PRInfoSchema.safeParse(pr);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(pr.id, 'pr-1');
    assert.ok(typeof pr.commentCount === 'number');
    assert.ok(Array.isArray(pr.reviewers));
  });

  test('fetchPR throws error for non-existent PR', async () => {
    try {
      await provider.fetchPR({ prId: 'non-existent' });
      assert.fail('Expected error for non-existent PR');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not found'));
    }
  });

  test('fetchPR works with branch name', async () => {
    const pr = await provider.fetchPR({ branch: 'feature/new-feature' });
    const parsed = PRInfoSchema.safeParse(pr);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(pr.branch?.from, 'feature/new-feature');
  });

  test('fetchCheckStatus returns check statuses that match CheckStatus schema', async () => {
    const checks = await provider.fetchCheckStatus({ prId: 'pr-1' });
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
    for (const check of checks) {
      const parsed = CheckStatusSchema.safeParse(check);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof check.id === 'string');
      assert.ok(typeof check.name === 'string');
    }
  });

  test('fetchCheckStatus returns annotations for failed checks', async () => {
    const checks = await provider.fetchCheckStatus({ prId: 'pr-1' });
    const failedCheck = checks.find((c) => c.conclusion === 'failure');
    assert.ok(failedCheck, 'Expected at least one failed check');
    assert.ok(Array.isArray(failedCheck.annotations));
    assert.ok(failedCheck.annotations.length > 0);
    assert.ok(failedCheck.failureReason);
  });

  test('fetchCheckStatus works with checkId', async () => {
    const checks = await provider.fetchCheckStatus({ prId: 'pr-1' });
    assert.ok(checks.length > 0);
    const checkId = checks[0].id;
    const singleCheck = await provider.fetchCheckStatus({ checkId, prId: 'pr-1' });
    assert.strictEqual(singleCheck.length, 1);
    assert.strictEqual(singleCheck[0].id, checkId);
  });

  test('fetchCheckStatus works with branch name', async () => {
    const checks = await provider.fetchCheckStatus({ branch: 'feature/new-feature' });
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
  });

  test('fetchComments returns comments that match Comment schema', async () => {
    const comments = await provider.fetchComments({ prId: 'pr-1' });
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
    const comments = await provider.fetchComments({ prId: 'pr-1' });
    const commentWithReactions = comments.find((c) => c.reactions && c.reactions.length > 0);
    assert.ok(commentWithReactions, 'Expected at least one comment with reactions');
    assert.ok(Array.isArray(commentWithReactions.reactions));
    assert.ok(commentWithReactions.reactions.length > 0);
  });

  test('fetchComments includes file location for file comments', async () => {
    const comments = await provider.fetchComments({ prId: 'pr-1' });
    const fileComment = comments.find((c) => c.path && c.line);
    assert.ok(fileComment, 'Expected at least one file comment');
    assert.ok(typeof fileComment.path === 'string');
    assert.ok(typeof fileComment.line === 'number');
  });

  test('fetchComments works with branch name', async () => {
    const comments = await provider.fetchComments({ branch: 'feature/new-feature' });
    assert.ok(Array.isArray(comments));
    assert.ok(comments.length > 0);
  });
});

describe('ci: provider registry discovery', () => {
  beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers smogcheck-provider from modules directory and registers it (with schema validation)', async () => {
    setProviderTypeSchema('ci', CIProviderSchema);

    const modulesDir = path.resolve(process.cwd(), 'modules');
    await discoverProvidersFromModules({ modulesDir });

    const providers = getProvidersByType('ci');
    assert.ok(providers.some((p) => p.name === 'smogcheck-provider'));

    const p = getProvider('ci', 'smogcheck-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'ci');
  });
});

