#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createYargs, installEpipeHandler } from '@barducks/sdk';
import { resolveBarducksRoot } from '@barducks/sdk';
import { findWorkspaceRoot } from '@barducks/sdk';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '@barducks/sdk';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider
} from '@barducks/sdk';
import type { EmailProvider, Message } from '../schemas/contract.js';
import emailExtension from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkspaceConfigLike = {
  extensionSettings?: Record<string, unknown>;
};

function asEmailProvider(p: unknown): EmailProvider {
  return p as EmailProvider;
}

function safeIsoNowMinusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function padRight(s: string, n: number): string {
  const v = String(s || '');
  if (v.length >= n) return v.slice(0, n);
  return v + ' '.repeat(n - v.length);
}

function truncate(s: string, n: number): string {
  const v = String(s || '');
  if (v.length <= n) return v;
  return v.slice(0, Math.max(0, n - 1)) + '…';
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function pickProviderNameFromConfig(workspaceRoot: string | null): string | null {
  const envName = (process.env.EMAIL_PROVIDER || '').trim();
  if (envName) return envName;

  const root = workspaceRoot || findWorkspaceRoot(process.cwd());
  if (!root) return null;

  const configPath = getWorkspaceConfigFilePath(root);
  if (!fs.existsSync(configPath)) return null;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const settings = (cfg && cfg.extensionSettings) || {};
  const emailSettings = (settings as Record<string, unknown>).email as Record<string, unknown> | undefined;
  const name = emailSettings && typeof emailSettings.provider === 'string' ? emailSettings.provider : '';
  return name.trim() || null;
}

function formatTable(messages: Message[]): string {
  const lines: string[] = [];
  lines.push(`${padRight('DATE', 10)}  ${padRight('FROM', 26)}  ${padRight('STATUS', 6)}  SUBJECT`);
  for (const m of messages) {
    const from = m.from && m.from.email ? m.from.email : '';
    const status = m.isRead ? 'read' : 'unread';
    lines.push(
      `${padRight(fmtDateShort(m.date), 10)}  ${padRight(truncate(from, 26), 26)}  ${padRight(status, 6)}  ${m.subject || ''}`
    );
  }
  return lines.join('\n');
}

async function main(argv = process.argv): Promise<void> {
  installEpipeHandler();

  const args = await createYargs(argv)
    .scriptName('email')
    .strict()
    .usage('Usage: $0 [--provider <name>] [--days <n>] [--since <iso>] [--limit <n>] [--json]')
    .option('provider', { type: 'string', describe: 'Provider name (overrides config/env)', default: '' })
    .option('days', { type: 'number', describe: 'Look back N days (default: 7)', default: 7 })
    .option('since', { type: 'string', describe: 'ISO timestamp (overrides --days)', default: '' })
    .option('limit', { type: 'number', describe: 'Max messages', default: 50 })
    .option('json', { type: 'boolean', describe: 'Output JSON instead of table', default: false })
    .parseAsync();

  const { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });
  const workspaceRoot = findWorkspaceRoot(process.cwd());

  // Discover providers from extensions
  await discoverProvidersFromModules({ extensionsDir: path.join(barducksRoot, 'extensions') });

  const providers = getProvidersByType('email');
  if (providers.length === 0) {
    throw new Error('No email providers discovered');
  }

  const explicit = String(args.provider || '').trim();
  const configured = pickProviderNameFromConfig(workspaceRoot);
  const selectedName = explicit || configured || providers[0].name;

  const selected = getProvider('email', selectedName);
  const provider = selected ? asEmailProvider(selected) : asEmailProvider(providers[0]);

  const days = typeof args.days === 'number' && Number.isFinite(args.days) ? Math.max(1, Math.floor(args.days)) : 7;
  const since = String(args.since || '').trim() || safeIsoNowMinusDays(days);
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : 50;

  // Create extension and call listUnreadMessages
  const ext = { provider };
  const workspace = { root: process.cwd(), config: {} };
  const definition = emailExtension(ext, workspace);
  const unread = await definition.api.listUnreadMessages._handler!({ since, limit });

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          provider: provider.name,
          since,
          count: unread.length,
          messages: unread
        },
        null,
        2
      )
    );
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  process.stdout.write(`Provider: ${provider.name}\n`);
  process.stdout.write(`Unread since: ${since}\n\n`);
  process.stdout.write(formatTable(unread));
  process.stdout.write(unread.length ? '\n' : '(no unread messages)\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    const err = e as { message?: string; stack?: string };
    // eslint-disable-next-line no-console
    console.error(err && err.stack ? err.stack : err.message || String(e));
    process.exitCode = 1;
  });
}

export { main };

