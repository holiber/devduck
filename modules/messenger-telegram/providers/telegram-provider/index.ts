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
    const id = `tg-${chatId}-${i + 1}`;
    out.push({
      id,
      chatId,
      date: new Date(now - i * 60_000).toISOString(),
      from: { id: 'tg-user-1', username: 'telegram_user', displayName: 'Telegram User' },
      text: `Mock Telegram message #${i + 1} in chat ${chatId}`,
      files: i === 0 ? [{ id: `tg-file-${chatId}-1`, filename: 'hello.txt', mimeType: 'text/plain' }] : []
    });
  }
  return out;
}

async function tdlibNotImplemented(): Promise<never> {
  throw new Error(
    'telegram-provider: TELEGRAM_PROVIDER_MODE=tdlib is selected, but TDLib integration is not implemented yet. ' +
      'Use mock mode or implement a TDLib adapter for getChatHistory/downloadFile.'
  );
}

const providerName = 'telegram-provider';
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
    description: 'Telegram provider for messenger module (mock; TDLib-ready scaffold)',
    protocolVersion: MESSENGER_PROVIDER_PROTOCOL_VERSION,
    tools: ['getChatHistory', 'downloadFile'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'none', requiredTokens: [] },
    capabilities: ['history', 'files', 'cache', 'mock']
  },

  async getChatHistory(input: GetChatHistoryInput): Promise<ChatMessage[]> {
    const mode = String(process.env.TELEGRAM_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `telegram:getChatHistory:${input.chatId}:${input.limit}:${input.beforeMessageId || ''}:${input.since || ''}`;

    return await getOrSetJsonCache({
      dir: cacheDir,
      key: cacheKey,
      ttlMs: historyTtlMs,
      compute: async () => {
        if (mode === 'mock') {
          return mockMessages(input.chatId, input.limit);
        }
        return await tdlibNotImplemented();
      }
    });
  },

  async downloadFile(input: DownloadFileInput): Promise<Buffer> {
    const mode = String(process.env.TELEGRAM_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `telegram:downloadFile:${input.fileId}`;

    const compute = async () => {
      if (mode === 'mock') {
        const body = `Mock Telegram file content for fileId=${input.fileId}\n`;
        return Buffer.from(body, 'utf8');
      }
      return await tdlibNotImplemented();
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

