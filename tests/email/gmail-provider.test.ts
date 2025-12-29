import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import provider from '../../extensions/email-gmail/providers/gmail-provider/index.js';
import type { EmailProvider } from '../../extensions/email/schemas/contract.js';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider
} from '../../src/lib/provider-registry.js';

describe('email: gmail-provider', () => {
  test('matches EmailProvider interface', () => {
    const p = provider as EmailProvider;
    assert.ok(p.name);
    assert.ok(p.version);
    assert.ok(p.manifest);
    assert.strictEqual(p.manifest.type, 'email');
    assert.strictEqual(p.manifest.name, 'gmail-provider');
    assert.ok(Array.isArray(p.manifest.tools));
    assert.ok(p.manifest.tools.includes('listUnreadMessages'));
    assert.ok(typeof p.getMessage === 'function');
    assert.ok(typeof p.searchMessages === 'function');
    assert.ok(typeof p.downloadAttachment === 'function');
    assert.ok(typeof p.listUnreadMessages === 'function');
  });
});

describe('email: provider registry discovery (gmail-provider)', () => {
  beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers gmail-provider from modules directory and registers it', async () => {
    const extensionsDir = path.resolve(process.cwd(), 'extensions');
    await discoverProvidersFromModules({ extensionsDir });

    const p = getProvider('email', 'gmail-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'email');
  });
});

