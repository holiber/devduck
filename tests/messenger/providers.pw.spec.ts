import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';

import telegramProvider from '../../modules/messenger-telegram/providers/telegram-provider/index.ts';
import yandexProvider from '../../modules/messenger-yandex-messenger/providers/yandex-messenger-provider/index.ts';
import {
  ChatMessageSchema,
  ChatSchema,
  DownloadFileResultSchema,
  MessengerProviderSchema,
  type MessengerProvider
} from '../../modules/messenger/schemas/contract.ts';

import {
  clearProvidersForTests,
  discoverProvidersFromModules,
  getProvider,
  getProvidersByType,
  setProviderTypeSchema
} from '../../scripts/lib/provider-registry.ts';

test.describe('messenger: telegram-provider', () => {
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

test.describe('messenger: yandex-messenger-provider', () => {
  test('matches MessengerProvider contract schema', () => {
    const p = yandexProvider as MessengerProvider;
    const parsed = MessengerProviderSchema.safeParse(p);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.strictEqual(p.manifest.type, 'messenger');
    assert.strictEqual(p.manifest.name, 'yandex-messenger-provider');
    assert.ok(p.manifest.tools.includes('listChats'));
    assert.ok(p.manifest.tools.includes('getChatHistory'));
    assert.ok(p.manifest.tools.includes('downloadFile'));
  });

  test('listChats returns chats that match Chat schema', async () => {
    const chats = await yandexProvider.listChats({ limit: 10, offset: 0 });
    assert.ok(Array.isArray(chats));
    for (const c of chats) {
      const parsed = ChatSchema.safeParse(c);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    }
  });

  test('getChatHistory returns messages that match ChatMessage schema', async () => {
    const msgs = await yandexProvider.getChatHistory({ chatId: 'ya-chat-1', limit: 5 });
    assert.ok(Array.isArray(msgs));
    assert.ok(msgs.length > 0);
    for (const m of msgs) {
      const parsed = ChatMessageSchema.safeParse(m);
      assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    }
  });

  test('downloadFile returns a descriptor that matches DownloadFileResult schema', async () => {
    const res = await yandexProvider.downloadFile({ fileId: 'ya-file-ya-chat-1-1', preferCache: true });
    const parsed = DownloadFileResultSchema.safeParse(res);
    assert.ok(parsed.success, parsed.success ? '' : parsed.error.message);
    assert.ok(res.path);
  });
});

test.describe('messenger: provider registry discovery', () => {
  test.beforeEach(() => {
    clearProvidersForTests();
  });

  test('discovers messenger providers from modules directory and registers them (with schema validation)', async () => {
    setProviderTypeSchema('messenger', MessengerProviderSchema);
    const modulesDir = path.resolve(process.cwd(), 'modules');
    await discoverProvidersFromModules({ modulesDir });

    const providers = getProvidersByType('messenger');
    assert.ok(providers.some((p) => p.name === 'telegram-provider'));
    assert.ok(providers.some((p) => p.name === 'yandex-messenger-provider'));

    const tg = getProvider('messenger', 'telegram-provider');
    assert.ok(tg);
    assert.strictEqual(tg?.manifest?.type, 'messenger');
  });
});

