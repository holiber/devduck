import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';

import provider from '../../modules/email/providers/smogcheck-provider/index.ts';
import {
  AttachmentSchema,
  MessageSchema,
  type EmailProvider
} from '../../modules/email/schemas/contract.ts';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType
} from '../../scripts/lib/provider-registry.ts';

function toIsoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

test.describe('email: smogcheck-provider', () => {
  test('matches EmailProvider interface', () => {
    const p = provider as EmailProvider;
    assert.ok(p.name);
    assert.ok(p.version);
    assert.ok(p.manifest);
    assert.strictEqual(p.manifest.type, 'email');
    assert.strictEqual(p.manifest.name, 'smogcheck-provider');
    assert.ok(Array.isArray(p.manifest.tools));
    assert.ok(p.manifest.tools.includes('listUnreadMessages'));
    assert.ok(typeof p.getMessage === 'function');
    assert.ok(typeof p.searchMessages === 'function');
    assert.ok(typeof p.downloadAttachment === 'function');
    assert.ok(typeof p.listUnreadMessages === 'function');
  });

  test('listUnreadMessages returns messages that match Message schema', async () => {
    const since = toIsoDaysAgo(365);
    const messages = await provider.listUnreadMessages({ since, limit: 100 });
    assert.ok(Array.isArray(messages));
    assert.ok(messages.length > 0);
    for (const m of messages) {
      const parsed = MessageSchema.safeParse(m);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
      assert.strictEqual(m.isRead, false);
      assert.ok(Date.parse(m.date) >= Date.parse(since));
    }
  });

  test('getMessage returns a message by id', async () => {
    const unread = await provider.listUnreadMessages({ since: toIsoDaysAgo(365), limit: 10 });
    assert.ok(unread.length > 0);

    const m = await provider.getMessage({ messageId: unread[0].id });
    const parsed = MessageSchema.safeParse(m);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(m.id, unread[0].id);
  });

  test('searchMessages supports filtering by from', async () => {
    const res = await provider.searchMessages({ from: 'alerts@smogcheck.local', limit: 50 });
    assert.ok(res.length > 0);
    assert.ok(res.every((m) => m.from.email === 'alerts@smogcheck.local'));
  });

  test('searchMessages supports filtering by participant (to/cc/bcc/from)', async () => {
    const res = await provider.searchMessages({ participant: 'user@example.com', limit: 50 });
    assert.ok(res.length > 0);
    assert.ok(
      res.every((m) => {
        const to = (m.to || []).map((x) => x.email);
        const cc = (m.cc || []).map((x) => x.email);
        const bcc = (m.bcc || []).map((x) => x.email);
        return (
          m.from.email === 'user@example.com' ||
          to.includes('user@example.com') ||
          cc.includes('user@example.com') ||
          bcc.includes('user@example.com')
        );
      })
    );
  });

  test('searchMessages supports filtering by date range', async () => {
    const after = toIsoDaysAgo(10);
    const before = toIsoDaysAgo(1);
    const res = await provider.searchMessages({ after, before, limit: 50 });
    assert.ok(
      res.every((m) => Date.parse(m.date) >= Date.parse(after) && Date.parse(m.date) <= Date.parse(before))
    );
  });

  test('downloadAttachment returns a Buffer for an existing attachment', async () => {
    const unread = await provider.listUnreadMessages({ since: toIsoDaysAgo(365), limit: 50 });
    const withAtt = unread.find((m) => Array.isArray(m.attachments) && m.attachments.length > 0);
    assert.ok(withAtt, 'Expected at least one unread message with attachments');

    const attachment = withAtt.attachments[0];
    const attParsed = AttachmentSchema.safeParse(attachment);
    assert.ok(attParsed.success, attParsed.success ? '' : attParsed.error.message);

    const buf = await provider.downloadAttachment({ messageId: withAtt.id, attachmentId: attachment.id });
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
  });
});

test.describe('email: provider registry discovery', () => {
  test.beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers smogcheck-provider from modules directory and registers it', async () => {
    const modulesDir = path.resolve(process.cwd(), 'modules');
    await discoverProvidersFromModules({ modulesDir });

    const providers = getProvidersByType('email');
    assert.ok(providers.some((p) => p.name === 'smogcheck-provider'));

    const p = getProvider('email', 'smogcheck-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'email');
  });
});

