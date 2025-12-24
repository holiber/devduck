import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import provider from '../../modules/email-gmail/providers/gmail-provider/index.js';
import { EmailProviderSchema } from '../../modules/email/schemas/contract.js';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  setProviderTypeSchema
} from '../../scripts/lib/provider-registry.js';

describe('email: gmail-provider', () => {
  test('matches EmailProvider contract schema', () => {
    const res = EmailProviderSchema.safeParse(provider);
    assert.ok(res.success, res.success ? '' : res.error.message);
    assert.strictEqual(provider.manifest.type, 'email');
    assert.strictEqual(provider.manifest.name, 'gmail-provider');
    assert.ok(Array.isArray(provider.manifest.tools));
    assert.ok(provider.manifest.tools.includes('listUnreadMessages'));
  });
});

describe('email: provider registry discovery (gmail-provider)', () => {
  beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers gmail-provider from modules directory and registers it (with schema validation)', async () => {
    setProviderTypeSchema('email', EmailProviderSchema);

    const modulesDir = path.resolve(process.cwd(), 'modules');
    await discoverProvidersFromModules({ modulesDir });

    const p = getProvider('email', 'gmail-provider');
    assert.ok(p);
    assert.strictEqual(p?.manifest?.type, 'email');
  });
});

