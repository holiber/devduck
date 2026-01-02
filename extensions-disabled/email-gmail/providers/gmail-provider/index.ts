import type {
  DownloadAttachmentInput,
  EmailAddress,
  EmailProvider,
  Message,
  SearchMessagesInput
} from '../../../email/schemas/contract.js';
import { EMAIL_PROVIDER_PROTOCOL_VERSION } from '../../../email/schemas/contract.js';

type GmailApiMessageHeader = { name?: string; value?: string };
type GmailApiMessagePartBody = { attachmentId?: string; size?: number; data?: string };
type GmailApiMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailApiMessageHeader[];
  body?: GmailApiMessagePartBody;
  parts?: GmailApiMessagePart[];
};

type GmailApiMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string; // epoch millis string
  payload?: GmailApiMessagePart;
};

function base64UrlToBuffer(s: string): Buffer {
  const normalized = String(s || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(s || '').length / 4) * 4, '=');
  return Buffer.from(normalized, 'base64');
}

function parseAddress(raw: string | null | undefined): EmailAddress | null {
  const v = String(raw || '').trim();
  if (!v) return null;

  const m = v.match(/^\s*(?:(.*?)\s*)?<([^>]+)>\s*$/);
  if (m) {
    const name = String(m[1] || '').trim().replace(/^"|"$/g, '');
    const email = String(m[2] || '').trim();
    return name ? { email, name } : { email };
  }
  // If there's no display name, treat the entire value as email.
  return { email: v };
}

function splitAddressList(raw: string | null | undefined): EmailAddress[] {
  const v = String(raw || '').trim();
  if (!v) return [];

  // Minimal RFC 5322-ish split: good enough for common "a@b.com, Name <c@d.com>" cases.
  const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
  const out: EmailAddress[] = [];
  for (const p of parts) {
    const addr = parseAddress(p);
    if (addr) out.push(addr);
  }
  return out;
}

function headerValue(headers: GmailApiMessageHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => String(x.name || '').toLowerCase() === name.toLowerCase());
  return String(h?.value || '').trim();
}

function isoFromInternalDate(internalDate: string | null | undefined): string {
  const ms = Number(internalDate || '');
  if (!Number.isFinite(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function isReadFromLabels(labelIds: string[] | undefined): boolean {
  const labels = new Set((labelIds || []).map((x) => String(x)));
  return !labels.has('UNREAD');
}

function walkParts(root: GmailApiMessagePart | undefined): GmailApiMessagePart[] {
  if (!root) return [];
  const out: GmailApiMessagePart[] = [];
  const stack: GmailApiMessagePart[] = [root];
  while (stack.length) {
    const p = stack.pop();
    if (!p) continue;
    out.push(p);
    const children = Array.isArray(p.parts) ? p.parts : [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

function pickBodyText(payload: GmailApiMessagePart | undefined): { text?: string; html?: string } {
  const parts = walkParts(payload);
  let text: string | undefined;
  let html: string | undefined;

  for (const p of parts) {
    const mime = String(p.mimeType || '').toLowerCase();
    const data = p.body?.data;
    if (!data) continue;
    if (!text && mime === 'text/plain') text = base64UrlToBuffer(data).toString('utf8');
    if (!html && mime === 'text/html') html = base64UrlToBuffer(data).toString('utf8');
    if (text && html) break;
  }
  return { text, html };
}

function extractAttachments(payload: GmailApiMessagePart | undefined): Message['attachments'] {
  const parts = walkParts(payload);
  const out: Message['attachments'] = [];
  for (const p of parts) {
    const filename = String(p.filename || '').trim();
    const attachmentId = String(p.body?.attachmentId || '').trim();
    if (!filename || !attachmentId) continue;
    const mimeType = String(p.mimeType || '').trim() || undefined;
    const sizeBytes = typeof p.body?.size === 'number' ? p.body.size : undefined;
    out.push({
      id: attachmentId,
      filename,
      mimeType,
      sizeBytes
    });
  }
  return out;
}

function toContractMessage(m: GmailApiMessage, includeBodies: boolean): Message {
  const id = String(m.id || '').trim();
  if (!id) {
    throw new Error('gmail-provider: Gmail API returned a message without id');
  }

  const headers = m.payload?.headers || [];

  const fromRaw = headerValue(headers, 'From');
  const from = parseAddress(fromRaw) || { email: 'unknown@example.com' };

  const to = splitAddressList(headerValue(headers, 'To'));
  const cc = splitAddressList(headerValue(headers, 'Cc'));
  const bcc = splitAddressList(headerValue(headers, 'Bcc'));

  const subject = headerValue(headers, 'Subject');
  const date = isoFromInternalDate(m.internalDate);
  const snippet = String(m.snippet || '') || undefined;

  const attachments = extractAttachments(m.payload);
  const isRead = isReadFromLabels(m.labelIds);

  const base: Message = {
    id,
    threadId: m.threadId ? String(m.threadId) : undefined,
    from,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject: subject || '',
    date,
    snippet,
    attachments,
    isRead
  };

  if (!includeBodies) return base;
  const bodies = pickBodyText(m.payload);
  return { ...base, ...bodies };
}

function requireAccessToken(): string {
  const token = String(process.env.GMAIL_ACCESS_TOKEN || '').trim();
  if (!token) {
    throw new Error(
      "gmail-provider: missing GMAIL_ACCESS_TOKEN. Set env var GMAIL_ACCESS_TOKEN (OAuth2 access token with Gmail scopes)."
    );
  }
  return token;
}

async function gmailApiGet<T>(
  path: string,
  query: Record<string, string | number | undefined | Array<string | number | undefined>> = {}
): Promise<T> {
  const token = requireAccessToken();
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === undefined || item === null || item === '') continue;
        url.searchParams.append(k, String(item));
      }
      continue;
    }
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`gmail-provider: Gmail API error ${res.status} ${res.statusText}: ${body}`.trim());
  }

  return (await res.json()) as T;
}

type GmailListMessagesResponse = { messages?: Array<{ id?: string }>; nextPageToken?: string };

async function listMessageIds(q: string, limit: number): Promise<string[]> {
  // Gmail API maxResults max is 500. Contract caps at 500.
  const maxResults = Math.max(1, Math.min(500, Math.floor(limit)));
  const resp = await gmailApiGet<GmailListMessagesResponse>('messages', { q, maxResults });
  return (resp.messages || []).map((m) => String(m.id || '')).filter(Boolean);
}

async function getMessageById(id: string, format: 'metadata' | 'full'): Promise<GmailApiMessage> {
  const query: Record<string, string | number | undefined | string[]> = { format };
  if (format === 'metadata') {
    // Include the headers we care about for fast listing/search.
    query.metadataHeaders = ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date'];
  }
  return await gmailApiGet<GmailApiMessage>(`messages/${encodeURIComponent(id)}`, query);
}

function gmailQueryFromSearch(input: SearchMessagesInput): string {
  const q: string[] = [];
  if (input.query) q.push(String(input.query));
  if (input.from) q.push(`from:${input.from}`);
  if (input.participant) {
    const p = input.participant;
    q.push(`(from:${p} OR to:${p} OR cc:${p})`);
  }
  if (input.after) {
    const sec = Math.floor(Date.parse(input.after) / 1000);
    if (Number.isFinite(sec)) q.push(`after:${sec}`);
  }
  if (input.before) {
    const sec = Math.floor(Date.parse(input.before) / 1000);
    if (Number.isFinite(sec)) q.push(`before:${sec}`);
  }
  return q.join(' ').trim();
}

const provider: EmailProvider = {
  name: 'gmail-provider',
  version: '0.1.0',
  manifest: {
    type: 'email',
    name: 'gmail-provider',
    version: '0.1.0',
    description: 'Gmail provider for email module (Gmail API)',
    protocolVersion: EMAIL_PROVIDER_PROTOCOL_VERSION,
    tools: ['getMessage', 'searchMessages', 'downloadAttachment', 'listUnreadMessages'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'oauth2', requiredTokens: ['GMAIL_ACCESS_TOKEN'] },
    capabilities: ['read', 'search', 'attachments']
  },

  async listUnreadMessages(input) {
    const sinceIso = input.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(input.limit))) : 50;
    const sinceSec = Math.floor(Date.parse(sinceIso) / 1000);
    const q = Number.isFinite(sinceSec) ? `is:unread after:${sinceSec}` : 'is:unread';

    const ids = await listMessageIds(q, limit);
    const out: Message[] = [];
    for (const id of ids) {
      const apiMsg = await getMessageById(id, 'metadata');
      out.push(toContractMessage(apiMsg, false));
    }
    return out;
  },

  async getMessage(input) {
    const apiMsg = await getMessageById(String(input.messageId), 'full');
    return toContractMessage(apiMsg, true);
  },

  async searchMessages(input) {
    const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(input.limit))) : 50;
    const q = gmailQueryFromSearch(input);
    const ids = await listMessageIds(q, limit);
    const out: Message[] = [];
    for (const id of ids) {
      const apiMsg = await getMessageById(id, 'metadata');
      out.push(toContractMessage(apiMsg, false));
    }
    return out;
  },

  async downloadAttachment(input: DownloadAttachmentInput) {
    const messageId = encodeURIComponent(String(input.messageId));
    const attachmentId = encodeURIComponent(String(input.attachmentId));
    const resp = await gmailApiGet<{ data?: string }>(
      `messages/${messageId}/attachments/${attachmentId}`
    );
    const data = String(resp.data || '');
    if (!data) throw new Error(`gmail-provider: attachment data missing for ${input.attachmentId}`);
    return base64UrlToBuffer(data);
  }
};

export default provider;

