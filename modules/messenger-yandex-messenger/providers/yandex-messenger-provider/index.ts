import type {
  Chat,
  ChatMessage,
  DownloadFileInput,
  DownloadFileResult,
  GetChatHistoryInput,
  ListChatsInput,
  MessengerProvider
} from '../../../messenger/schemas/contract.js';
import { MESSENGER_PROVIDER_PROTOCOL_VERSION } from '../../../messenger/schemas/contract.js';
import {
  getMessengerCacheDir,
  getOrSetFileCache,
  getOrSetJsonCache,
  isMessengerCacheDisabled,
  writeTempBufferFile
} from '../../../messenger/cache.js';

function envInt(name: string, fallback: number): number {
  const raw = String(process.env[name] || '').trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function mockChats(): Chat[] {
  return [
    { id: 'ya-chat-1', title: 'Mock Yandex Messenger Chat 1', type: 'private' },
    { id: 'ya-chat-2', title: 'Mock Yandex Messenger Chat 2', type: 'group', participantsCount: 5 }
  ];
}

function parseMockMessageNum(id: string): number | null {
  const m = String(id || '').match(/-(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mockLatestNum(chatId: string): number {
  const base = 400;
  let acc = 0;
  for (const ch of String(chatId)) acc = (acc * 33 + ch.charCodeAt(0)) % 600;
  return base + (acc % 400); // [400..799]
}

function mockPageDescending(chatId: string, beforeNumExclusive: number, count: number): ChatMessage[] {
  const now = Date.now();
  const out: ChatMessage[] = [];
  const latest = mockLatestNum(chatId);
  const upperExclusive = Math.min(beforeNumExclusive, latest + 1);
  for (let i = 0; i < count; i++) {
    const num = upperExclusive - 1 - i;
    if (num <= 0) break;
    const id = `ya-${chatId}-${num}`;
    out.push({
      id,
      chatId,
      date: new Date(now - (latest - num) * 45_000).toISOString(),
      from: { id: 'ya-user-1', username: 'yandex_user', displayName: 'Yandex User' },
      text: `Mock Yandex Messenger message #${num} in chat ${chatId}`,
      files:
        num === latest - 1
          ? [
              {
                id: `ya-file-${chatId}-1`,
                providerFileId: `yandex:${98765}`,
                filename: 'image.png',
                mimeType: 'image/png'
              }
            ]
          : []
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
const chatsTtlMs = envInt('MESSENGER_CHATS_TTL_MS', 30_000);
const historyTtlMs = envInt('MESSENGER_CHAT_HISTORY_TTL_MS', 30_000);
const pageSize = Math.max(1, Math.min(200, envInt('MESSENGER_CHAT_HISTORY_PAGE_SIZE', 50)));
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
    tools: ['listChats', 'getChatHistory', 'downloadFile'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'apiKey', requiredTokens: ['YANDEX_MESSENGER_TOKEN'] },
    capabilities: ['history', 'files', 'cache', 'mock']
  },

  async listChats(input: ListChatsInput): Promise<Chat[]> {
    const mode = String(process.env.YANDEX_MESSENGER_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `yandex:listChats:${input.limit}:${input.offset}:${input.query || ''}`;

    return await getOrSetJsonCache({
      dir: cacheDir,
      key: cacheKey,
      ttlMs: chatsTtlMs,
      compute: async () => {
        if (mode === 'mock') {
          const all = mockChats();
          const filtered = input.query
            ? all.filter((c) => String(c.title || '').toLowerCase().includes(String(input.query).toLowerCase()))
            : all;
          return filtered.slice(input.offset, input.offset + input.limit);
        }
        return await httpNotImplemented();
      }
    });
  },

  async getChatHistory(input: GetChatHistoryInput): Promise<ChatMessage[]> {
    const mode = String(process.env.YANDEX_MESSENGER_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const sinceMs = input.since ? Date.parse(input.since) : Number.NaN;

    const out: ChatMessage[] = [];
    let cursor: string | undefined = input.beforeMessageId;
    while (out.length < input.limit) {
      const pageKey = `yandex:getChatHistoryPage:${input.chatId}:${pageSize}:${cursor || 'latest'}`;
      const page = await getOrSetJsonCache({
        dir: cacheDir,
        key: pageKey,
        ttlMs: historyTtlMs,
        compute: async () => {
          if (mode !== 'mock') return await httpNotImplemented();
          const latest = mockLatestNum(input.chatId);
          const beforeNum = cursor ? parseMockMessageNum(cursor) : null;
          const beforeExclusive = beforeNum ? beforeNum : latest + 1;
          return mockPageDescending(input.chatId, beforeExclusive, pageSize);
        }
      });

      const useSince = Number.isFinite(sinceMs);
      const filtered = useSince ? page.filter((m) => Date.parse(m.date) >= sinceMs) : page;

      out.push(...filtered.slice(0, input.limit - out.length));
      if (page.length < pageSize) break;
      const last = page[page.length - 1];
      if (!last?.id) break;
      cursor = last.id;
      if (useSince) {
        const oldestDateMs = Date.parse(last.date);
        if (Number.isFinite(oldestDateMs) && oldestDateMs < sinceMs) break;
      }
    }

    return out;
  },

  async downloadFile(input: DownloadFileInput): Promise<DownloadFileResult> {
    const mode = String(process.env.YANDEX_MESSENGER_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `yandex:downloadFile:${input.fileId}`;

    const compute = async (): Promise<{ buffer: Buffer; mimeType?: string; originalFileId?: string }> => {
      if (mode === 'mock') {
        const body = `Mock Yandex Messenger file content for fileId=${input.fileId}\n`;
        return { buffer: Buffer.from(body, 'utf8'), mimeType: 'application/octet-stream', originalFileId: input.fileId };
      }
      return await httpNotImplemented();
    };

    if (!input.preferCache || isMessengerCacheDisabled()) {
      const computed = await compute();
      const tmp = writeTempBufferFile({ providerName, key: cacheKey, buffer: computed.buffer });
      return {
        fileId: input.fileId,
        originalFileId: computed.originalFileId || input.fileId,
        cached: false,
        path: tmp.path,
        sizeBytes: tmp.sizeBytes,
        mimeType: computed.mimeType,
        sha256: tmp.sha256
      };
    }

    const cached = await getOrSetFileCache({
      dir: cacheDir,
      key: cacheKey,
      ttlMs: fileTtlMs,
      compute,
      providerName
    });
    return { fileId: input.fileId, originalFileId: input.fileId, ...cached };
  }
};

export default provider;

