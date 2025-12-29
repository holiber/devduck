import type {
  DownloadAttachmentInput,
  EmailProvider,
  Message,
  SearchMessagesInput
} from '../../schemas/contract.js';
import { EMAIL_PROVIDER_PROTOCOL_VERSION } from '../../schemas/contract.js';

function nowMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

const ATTACHMENT_CONTENT: Record<string, Buffer> = {
  'att-1': Buffer.from('This is a smogcheck attachment.\n', 'utf8'),
  'att-2': Buffer.from([0xde, 0xad, 0xbe, 0xef])
};

const MESSAGES: Message[] = [
  {
    id: 'msg-1',
    threadId: 'thr-1',
    from: { email: 'alerts@smogcheck.local', name: 'Smogcheck Alerts' },
    to: [{ email: 'user@example.com', name: 'User' }],
    subject: 'Smogcheck: weekly report',
    date: nowMinusDays(2),
    snippet: 'Your weekly report is ready.',
    text: 'Hello!\n\nYour weekly report is ready.\n\n— Smogcheck\n',
    attachments: [{ id: 'att-1', filename: 'report.txt', mimeType: 'text/plain', sizeBytes: 31 }],
    isRead: false
  },
  {
    id: 'msg-2',
    threadId: 'thr-1',
    from: { email: 'alerts@smogcheck.local', name: 'Smogcheck Alerts' },
    to: [{ email: 'user@example.com', name: 'User' }],
    subject: 'Smogcheck: action required',
    date: nowMinusDays(5),
    snippet: 'Please confirm your email settings.',
    text: 'Please confirm your email settings.\n',
    attachments: [{ id: 'att-2', filename: 'payload.bin', mimeType: 'application/octet-stream', sizeBytes: 4 }],
    isRead: false
  },
  {
    id: 'msg-3',
    threadId: 'thr-2',
    from: { email: 'noreply@smogcheck.local', name: 'Smogcheck' },
    to: [{ email: 'user@example.com', name: 'User' }],
    subject: 'Welcome to Smogcheck',
    date: nowMinusDays(30),
    snippet: 'Welcome!',
    text: 'Welcome to Smogcheck.\n',
    attachments: [],
    isRead: true
  }
];

function byDateDesc(a: Message, b: Message): number {
  return Date.parse(b.date) - Date.parse(a.date);
}

function matchesQuery(m: Message, q: string): boolean {
  const needle = q.toLowerCase();
  const hay = [
    m.subject,
    m.snippet || '',
    m.text || '',
    m.html || '',
    m.from.email,
    m.from.name || ''
  ]
    .join('\n')
    .toLowerCase();
  return hay.includes(needle);
}

function matchesSearch(m: Message, input: SearchMessagesInput): boolean {
  if (input.from && m.from.email !== input.from) return false;

  if (input.participant) {
    const p = input.participant;
    const recipients = [...(m.to || []), ...(m.cc || []), ...(m.bcc || [])].map((x) => x.email);
    if (m.from.email !== p && !recipients.includes(p)) return false;
  }

  if (input.after && Date.parse(m.date) < Date.parse(input.after)) return false;
  if (input.before && Date.parse(m.date) > Date.parse(input.before)) return false;

  if (input.query && !matchesQuery(m, input.query)) return false;
  return true;
}

const provider: EmailProvider = {
  name: 'smogcheck-provider',
  version: '0.1.0',
  manifest: {
    type: 'email',
    name: 'smogcheck-provider',
    version: '0.1.0',
    description: 'Test provider for email module',
    protocolVersion: EMAIL_PROVIDER_PROTOCOL_VERSION,
    tools: ['getMessage', 'searchMessages', 'downloadAttachment', 'listUnreadMessages'],
    events: { publish: [], subscribe: [] },
    auth: { type: 'none', requiredTokens: [] },
    capabilities: ['read', 'search', 'attachments']
  },

  async getMessage(input) {
    const msg = MESSAGES.find((m) => m.id === input.messageId);
    if (!msg) throw new Error(`Message not found: ${input.messageId}`);
    return msg;
  },

  async searchMessages(input) {
    const limit = typeof input.limit === 'number' ? input.limit : 50;
    return MESSAGES.filter((m) => matchesSearch(m, input)).sort(byDateDesc).slice(0, limit);
  },

  async downloadAttachment(input: DownloadAttachmentInput) {
    const msg = MESSAGES.find((m) => m.id === input.messageId);
    if (!msg) throw new Error(`Message not found: ${input.messageId}`);
    const att = (msg.attachments || []).find((a) => a.id === input.attachmentId);
    if (!att) throw new Error(`Attachment not found: ${input.attachmentId}`);
    const buf = ATTACHMENT_CONTENT[input.attachmentId];
    if (!buf) throw new Error(`Attachment content missing: ${input.attachmentId}`);
    return buf;
  },

  async listUnreadMessages(input) {
    const since = input.since ? Date.parse(input.since) : Date.parse(nowMinusDays(7));
    const limit = typeof input.limit === 'number' ? input.limit : 50;
    return MESSAGES.filter((m) => !m.isRead && Date.parse(m.date) >= since).sort(byDateDesc).slice(0, limit);
  }
};

export default provider;

