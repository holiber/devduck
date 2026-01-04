import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';

import telegramProvider from '../../extensions/messenger-telegram/providers/telegram-provider/index.js';
import imProvider from '../../extensions/messenger-im/providers/im-messenger-provider/index.js';
import {
  ChatMessageSchema,
  ChatSchema,
  DownloadFileResultSchema,
  MessengerProviderSchema,
  type MessengerProvider
} from '../../extensions/messenger/schemas/contract.js';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType,
  setProviderTypeSchema
} from '../../src/lib/providers-registry.js';

describe('messenger: telegram-provider', () => {
  test('matches MessengerProvider contract schema', () => {
    const p = telegramProvider as MessengerProvider;
    const parsed = MessengerProviderSchema.safeParse(p);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(p.manifest.type, 'messenger');
    assert.strictEqual(p.manifest.name, 'telegram-provider');
    assert.ok(p.manifest.tools.includes('listChats'));
    assert.ok(p.manifest.tools.includes('getChatHistory'));
    assert.ok(p.manifest.tools.includes('downloadFile'));
  });

  test('listChats returns chats that match Chat schema', async () => {
    const chats = await telegramProvider.listChats({ limit: 10, offset: 0 });
    assert.ok(Array.isArray(chats));
    for (const c of chats) {
      const parsed = ChatSchema.safeParse(c);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    }
  });

  test('getChatHistory returns messages that match ChatMessage schema', async () => {
    const msgs = await telegramProvider.getChatHistory({ chatId: 'tg-chat-1', limit: 5 });
    assert.ok(Array.isArray(msgs));
    assert.ok(msgs.length > 0);
    for (const m of msgs) {
      const parsed = ChatMessageSchema.safeParse(m);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    }
  });

  test('downloadFile returns a descriptor that matches DownloadFileResult schema', async () => {
    const res = await telegramProvider.downloadFile({ fileId: 'tg-file-tg-chat-1-1', preferCache: true });
    const parsed = DownloadFileResultSchema.safeParse(res);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.ok(res.path);
  });
});

describe('messenger: im-messenger-provider', () => {
  test('matches MessengerProvider contract schema', () => {
    const p = imProvider as MessengerProvider;
    const parsed = MessengerProviderSchema.safeParse(p);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(p.manifest.type, 'messenger');
    assert.strictEqual(p.manifest.name, 'im-messenger-provider');
    assert.ok(p.manifest.tools.includes('listChats'));
    assert.ok(p.manifest.tools.includes('getChatHistory'));
    assert.ok(p.manifest.tools.includes('downloadFile'));
  });

  test('listChats returns chats that match Chat schema', async () => {
    const chats = await imProvider.listChats({ limit: 10, offset: 0 });
    assert.ok(Array.isArray(chats));
    for (const c of chats) {
      const parsed = ChatSchema.safeParse(c);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    }
  });

  test('getChatHistory returns messages that match ChatMessage schema', async () => {
    const msgs = await imProvider.getChatHistory({ chatId: 'im-chat-1', limit: 5 });
    assert.ok(Array.isArray(msgs));
    assert.ok(msgs.length > 0);
    for (const m of msgs) {
      const parsed = ChatMessageSchema.safeParse(m);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    }
  });

  test('downloadFile returns a descriptor that matches DownloadFileResult schema', async () => {
    const res = await imProvider.downloadFile({ fileId: 'im-file-im-chat-1-1', preferCache: true });
    const parsed = DownloadFileResultSchema.safeParse(res);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.ok(res.path);
  });
});

describe('messenger: provider registry discovery', () => {
  beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers messenger providers from modules directory and registers them (with schema validation)', async () => {
    setProviderTypeSchema('messenger', MessengerProviderSchema);
    const extensionsDir = path.resolve(process.cwd(), 'extensions');
    await discoverProvidersFromModules({ extensionsDir });

    const providers = getProvidersByType('messenger');
    assert.ok(providers.some((p) => p.name === 'telegram-provider'));
    assert.ok(providers.some((p) => p.name === 'im-messenger-provider'));

    const tg = getProvider('messenger', 'telegram-provider');
    assert.ok(tg);
    assert.strictEqual(tg?.manifest?.type, 'messenger');
  });
});

