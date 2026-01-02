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
    { id: 'tg-chat-1', title: 'Mock Telegram Chat 1', type: 'private' },
    { id: 'tg-chat-2', title: 'Mock Telegram Chat 2', type: 'group', participantsCount: 12 }
  ];
}

function parseMockMessageNum(id: string): number | null {
  const m = String(id || '').match(/-(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mockLatestNum(chatId: string): number {
  // Deterministic-ish per chat, keeps "latest" stable across calls.
  const base = 500;
  let acc = 0;
  for (const ch of String(chatId)) acc = (acc + ch.charCodeAt(0)) % 500;
  return base + acc; // [500..999]
}

function mockPageDescending(chatId: string, beforeNumExclusive: number, count: number): ChatMessage[] {
  const now = Date.now();
  const out: ChatMessage[] = [];
  const latest = mockLatestNum(chatId);
  const upperExclusive = Math.min(beforeNumExclusive, latest + 1);
  for (let i = 0; i < count; i++) {
    const num = upperExclusive - 1 - i;
    if (num <= 0) break;
    const id = `tg-${chatId}-${num}`;
    out.push({
      id,
      chatId,
      // Higher num => newer. Distance from latest => age.
      date: new Date(now - (latest - num) * 60_000).toISOString(),
      from: { id: 'tg-user-1', username: 'telegram_user', displayName: 'Telegram User' },
      text: `Mock Telegram message #${num} in chat ${chatId}`,
      files:
        num === latest
          ? [
              {
                id: `tg-file-${chatId}-1`,
                providerFileId: `tdlib:${123456}`,
                filename: 'hello.txt',
                mimeType: 'text/plain'
              }
            ]
          : []
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
    description: 'Telegram provider for messenger module (mock; TDLib-ready scaffold)',
    protocolVersion: MESSENGER_PROVIDER_PROTOCOL_VERSION,
    tools: ['listChats', 'getChatHistory', 'downloadFile'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'none', requiredTokens: [] },
    capabilities: ['history', 'files', 'cache', 'mock']
  },

  async listChats(input: ListChatsInput): Promise<Chat[]> {
    const mode = String(process.env.TELEGRAM_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `telegram:listChats:${input.limit}:${input.offset}:${input.query || ''}`;

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
        return await tdlibNotImplemented();
      }
    });
  },

  async getChatHistory(input: GetChatHistoryInput): Promise<ChatMessage[]> {
    const mode = String(process.env.TELEGRAM_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const sinceMs = input.since ? Date.parse(input.since) : Number.NaN;

    const out: ChatMessage[] = [];
    let cursor: string | undefined = input.beforeMessageId;
    const seenCursors = new Set<string>();
    while (out.length < input.limit) {
      const cursorKey = String(cursor || '').trim() || 'latest';
      if (seenCursors.has(cursorKey)) break;
      seenCursors.add(cursorKey);

      const pageKey = `telegram:getChatHistoryPage:${input.chatId}:${pageSize}:${cursorKey}`;
      const page = await getOrSetJsonCache({
        dir: cacheDir,
        key: pageKey,
        ttlMs: historyTtlMs,
        compute: async () => {
          if (mode !== 'mock') return await tdlibNotImplemented();
          const latest = mockLatestNum(input.chatId);
          const beforeNum = cursorKey !== 'latest' ? parseMockMessageNum(cursorKey) : null;
          const beforeExclusive = beforeNum ? beforeNum : latest + 1; // "before" means strictly older than this id
          return mockPageDescending(input.chatId, beforeExclusive, pageSize);
        }
      });

      // TDLib-like: results are newest -> oldest. Stop paging when the oldest item in the page is older than `since`.
      const useSince = Number.isFinite(sinceMs);
      if (page.length === 0) break;
      const filtered = useSince ? page.filter((m) => Date.parse(m.date) >= sinceMs) : page;

      out.push(...filtered.slice(0, input.limit - out.length));
      if (useSince) {
        // Decide whether we need *another* page. We still keep any useful messages from the current page.
        const oldest = page[page.length - 1];
        const oldestDateMs = oldest?.date ? Date.parse(oldest.date) : Number.NaN;
        if (Number.isFinite(oldestDateMs) && oldestDateMs < sinceMs) break;
      }
      if (page.length < pageSize) break;
      const last = page[page.length - 1];
      if (!last?.id) break;
      cursor = last.id;
    }

    return out;
  },

  async downloadFile(input: DownloadFileInput): Promise<DownloadFileResult> {
    const mode = String(process.env.TELEGRAM_PROVIDER_MODE || 'mock').trim().toLowerCase();
    const cacheKey = `telegram:downloadFile:${input.fileId}`;

    const compute = async (): Promise<{ buffer: Buffer; mimeType?: string; originalFileId?: string }> => {
      if (mode === 'mock') {
        const body = `Mock Telegram file content for fileId=${input.fileId}\n`;
        return { buffer: Buffer.from(body, 'utf8'), mimeType: 'text/plain', originalFileId: input.fileId };
      }
      return await tdlibNotImplemented();
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
    return { fileId: input.fileId, ...cached, originalFileId: cached.originalFileId || input.fileId };
  }
};

export default provider;

