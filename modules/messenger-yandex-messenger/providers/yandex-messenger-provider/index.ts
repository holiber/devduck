import { Buffer } from 'node:buffer';

import type {
  ChatMessage,
  DownloadFileInput,
  GetChatHistoryInput,
  MessengerProvider
} from '../../../messenger/schemas/contract.js';
import { MESSENGER_PROVIDER_PROTOCOL_VERSION } from '../../../messenger/schemas/contract.js';
import { getMessengerCacheDir, getOrSetBufferCache, getOrSetJsonCache } from '../../../messenger/cache.js';

function envInt(name: string, fallback: number): number {
  const raw = String(process.env[name] || '').trim();
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function mockMessages(chatId: string, limit: number): ChatMessage[] {
  const now = Date.now();
  const out: ChatMessage[] = [];
  for (let i = 0; i < limit; i++) {
    const id = `ya-${chatId}-${i + 1}`;
    out.push({
      id,
      chatId,
      date: new Date(now - i * 45_000).toISOString(),
      from: { id: 'ya-user-1', username: 'yandex_user', displayName: 'Yandex User' },
      text: `Mock Yandex Messenger message #${i + 1} in chat ${chatId}`,
      files: i === 1 ? [{ id: `ya-file-${chatId}-1`, filename: 'image.png', mimeType: 'image/png' }] : []
    });
  }
  return out;
}

async function httpNotImplemented(): Promise<never> {
  const baseUrl = String(process.env.YANDEX_MESSENGER_API_BASE_URL || '').trim();
  const token = String(process.env.YANDEX_MESSENGER_TOKEN || '').trim();
  throw new Error(
    'yandex-messenger-provider: YANDEX_MESSENGER_PROVIDER_MODE=http is selected, but HTTP API integration is not implemented yet. ' +
      `Provided baseUrl=${baseUrl ? 'yes' : 'no'}, token=${token ? 'yes' : 'no'}. ` +
      'Implement API calls + response mapping for getChatHistory/downloadFile.'
  );
}

const providerName = 'yandex-messenger-provider';
const cacheDir = getMessengerCacheDir({ providerName });
const historyTtlMs = envInt('MESSENGER_CHAT_HISTORY_TTL_MS', 30_000);
const fileTtlMs = envInt('MESSENGER_FILE_TTL_MS', 7 * 24 * 60 * 60 * 1000);

const provider: MessengerProvider = {
  name: providerName,
  version: '0.1.0',
  manifest: {
    type: 'messenger',
    name: providerName,
    version: '0.1.0',
    description: 'Yandex Messenger provider for messenger module (mock; HTTP API scaffold)',
    protocolVersion: MESSENGER_PROVIDER_PROTOCOL_VERSION,
    tools: ['getChatHistory', 'downloadFile'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'apiKey', requiredTokens: ['YANDEX_MESSENGER_TOKEN'] },
    capabilities: ['history', 'files', 'cache', 'mock']
  },

  async getChatHistory(input: GetChatHistoryInput): Promise<ChatMessage[]> {
    const mode = String(process.env.YANDEX_MESSENGER_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `yandex:getChatHistory:${input.chatId}:${input.limit}:${input.beforeMessageId || ''}:${input.since || ''}`;

    return await getOrSetJsonCache({
      dir: cacheDir,
      key: cacheKey,
      ttlMs: historyTtlMs,
      compute: async () => {
        if (mode === 'mock') {
          return mockMessages(input.chatId, input.limit);
        }
        return await httpNotImplemented();
      }
    });
  },

  async downloadFile(input: DownloadFileInput): Promise<Buffer> {
    const mode = String(process.env.YANDEX_MESSENGER_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `yandex:downloadFile:${input.fileId}`;

    const compute = async () => {
      if (mode === 'mock') {
        const body = `Mock Yandex Messenger file content for fileId=${input.fileId}\n`;
        return Buffer.from(body, 'utf8');
      }
      return await httpNotImplemented();
    };

    if (!input.preferCache) return await compute();

    return await getOrSetBufferCache({
      dir: cacheDir,
      key: cacheKey,
      ttlMs: fileTtlMs,
      compute
    });
  }
};

export default provider;

