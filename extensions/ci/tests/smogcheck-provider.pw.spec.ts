import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';

import provider from '../providers/smogcheck-provider/index.ts';
import {
  PRInfoSchema,
  CheckStatusSchema,
  CommentSchema,
  type CIProvider
} from '../api.ts';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType
} from '../../../src/lib/provider-registry.ts';

test.describe('ci: smogcheck-provider', () => {
  test('matches CIProvider interface', () => {
    const p = provider as CIProvider;
    assert.ok(p.name);
    assert.ok(p.version);
    assert.ok(p.manifest);
    assert.strictEqual(p.manifest.type, 'ci');
    assert.strictEqual(p.manifest.name, 'smogcheck-provider');
    assert.ok(Array.isArray(p.manifest.tools));
    assert.ok(p.manifest.tools.includes('pr.list'));
    assert.ok(p.manifest.tools.includes('pr.get'));
    assert.ok(p.manifest.tools.includes('pr.post'));
    assert.ok(p.manifest.tools.includes('pr.delete'));
    assert.ok(p.manifest.tools.includes('pr.checks.list'));
    assert.ok(p.manifest.tools.includes('pr.checks.get'));
    assert.ok(p.manifest.tools.includes('comment.list'));
    assert.ok(p.manifest.tools.includes('comment.get'));
    assert.ok(p.manifest.tools.includes('comment.post'));
    assert.ok(p.manifest.tools.includes('comment.put'));
    assert.ok(p.manifest.tools.includes('comment.delete'));

    assert.ok(p.pr);
    assert.ok(p.pr.checks);
    assert.ok(p.comment);
    assert.ok(typeof p.pr.get === 'function');
    assert.ok(typeof p.pr.checks.list === 'function');
    assert.ok(typeof p.comment.list === 'function');
  });

  test('pr.get returns PR info that matches PRInfo schema', async () => {
    const pr = await provider.pr.get({ prId: 'pr-1' });
    const parsed = PRInfoSchema.safeParse(pr);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(pr.id, 'pr-1');
    assert.ok(typeof pr.commentCount === 'number');
    assert.ok(Array.isArray(pr.reviewers));
  });

  test('pr.get throws error for non-existent PR', async () => {
    try {
      await provider.pr.get({ prId: 'non-existent' });
      assert.fail('Expected error for non-existent PR');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('not found'));
    }
  });

  test('pr.list can filter by branch name', async () => {
    const prs = await provider.pr.list({ branch: 'feature/new-feature' });
    assert.ok(Array.isArray(prs));
    assert.ok(prs.length > 0);
    const pr = prs[0];
    const parsed = PRInfoSchema.safeParse(pr);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(pr.branch?.from, 'feature/new-feature');
  });

  test('pr.checks.list returns check statuses that match CheckStatus schema', async () => {
    const checks = await provider.pr.checks.list({ prId: 'pr-1' });
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
    for (const check of checks) {
      const parsed = CheckStatusSchema.safeParse(check);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.ok(typeof check.id === 'string');
      assert.ok(typeof check.name === 'string');
    }
  });

  test('pr.checks.list returns annotations for failed checks', async () => {
    const checks = await provider.pr.checks.list({ prId: 'pr-1' });
    const failedCheck = checks.find((c) => c.conclusion === 'failure');
    assert.ok(failedCheck, 'Expected at least one failed check');
    assert.ok(Array.isArray(failedCheck.annotations));
    assert.ok(failedCheck.annotations.length > 0);
    assert.ok(failedCheck.failureReason);
  });

  test('pr.checks.get works with checkId', async () => {
    const checks = await provider.pr.checks.list({ prId: 'pr-1' });
    assert.ok(checks.length > 0);
    const checkId = checks[0].id;
    const check = await provider.pr.checks.get({ checkId });
    assert.strictEqual(check.id, checkId);
  });

  test('pr.checks.list works with branch name', async () => {
    const checks = await provider.pr.checks.list({ branch: 'feature/new-feature' });
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
  });

  test('comment.list returns comments that match Comment schema', async () => {
    const comments = await provider.comment.list({ prId: 'pr-1' });
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

  test('comment.list includes reactions', async () => {
    const comments = await provider.comment.list({ prId: 'pr-1' });
    const commentWithReactions = comments.find((c) => c.reactions && c.reactions.length > 0);
    assert.ok(commentWithReactions, 'Expected at least one comment with reactions');
    assert.ok(Array.isArray(commentWithReactions.reactions));
    assert.ok(commentWithReactions.reactions.length > 0);
  });

  test('comment.list includes file location for file comments', async () => {
    const comments = await provider.comment.list({ prId: 'pr-1' });
    const fileComment = comments.find((c) => c.path && c.line);
    assert.ok(fileComment, 'Expected at least one file comment');
    assert.ok(typeof fileComment.path === 'string');
    assert.ok(typeof fileComment.line === 'number');
  });

  test('comment.list works with branch name', async () => {
    const comments = await provider.comment.list({ branch: 'feature/new-feature' });
    assert.ok(Array.isArray(comments));
    assert.ok(comments.length > 0);
  });

  test('comment.post creates a comment that matches Comment schema', async () => {
    const created = await provider.comment.post({ prId: 'pr-1', body: 'Hello from test' });
    const parsed = CommentSchema.safeParse(created);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.ok(created.id);
    assert.strictEqual(created.body, 'Hello from test');

    const comments = await provider.comment.list({ prId: 'pr-1' });
    assert.ok(comments.some((c) => c.id === created.id));
  });
});

test.describe('ci: provider registry discovery', () => {
  test.beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers smogcheck-provider from modules directory and registers it', async () => {
    const extensionsDir = path.resolve(process.cwd(), 'extensions');
    await discoverProvidersFromModules({ extensionsDir });

    const providers = getProvidersByType('ci');
    assert.ok(providers.some((p) => p.name === 'smogcheck-provider'));

    const p = getProvider('ci', 'smogcheck-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'ci');
  });
});

