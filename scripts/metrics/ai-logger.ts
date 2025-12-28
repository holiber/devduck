#!/usr/bin/env npx tsx
/**
 * AI Agent Logger
 *
 * Collects and saves AI agent chat logs from various sources:
 * - Cursor AI conversations
 * - Claude sessions
 * - GPT logs
 * - Custom agent logs
 *
 * Usage:
 *   npx tsx scripts/metrics/ai-logger.ts --agent cursor --summary "Fixed bug in X"
 *   npx tsx scripts/metrics/ai-logger.ts --agent claude --session abc123 --files "a.ts,b.ts"
 *   npx tsx scripts/metrics/ai-logger.ts --scan  # Scan for existing AI logs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { DEFAULT_CONFIG, type AIAgentLog } from './types.js';

const config = DEFAULT_CONFIG;

interface LogOptions {
  agent: string;
  summary: string;
  sessionId?: string;
  filesModified?: string[];
  durationSec?: number;
  messageCount?: number;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  rawData?: unknown;
}

/**
 * Ensures AI logs directory exists
 */
function ensureAILogsDir(): void {
  mkdirSync(config.aiLogsDir, { recursive: true });
}

/**
 * Creates and saves an AI agent log entry
 */
function createAILog(options: LogOptions): AIAgentLog {
  ensureAILogsDir();

  const log: AIAgentLog = {
    id: randomUUID(),
    agent: options.agent,
    sessionId: options.sessionId,
    timestamp: new Date().toISOString(),
    summary: options.summary,
    durationSec: options.durationSec,
    filesModified: options.filesModified,
    messageCount: options.messageCount,
    tokens: options.tokens,
    rawData: options.rawData,
  };

  const filename = `${log.agent}-${Date.now()}-${log.id.slice(0, 8)}.json`;
  const logPath = path.join(config.aiLogsDir, filename);

  writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`✅ AI log saved: ${logPath}`);

  return log;
}

/**
 * Scans known locations for AI agent logs and copies them to .cache/ai_logs
 */
function scanForAILogs(): AIAgentLog[] {
  ensureAILogsDir();
  const foundLogs: AIAgentLog[] = [];

  // Known locations for AI agent logs
  const knownLocations = [
    // Cursor AI logs (if available in project)
    '.cursor/logs',
    '.cursor/chat-history',
    // Claude desktop logs
    path.join(process.env.HOME ?? '', '.claude/logs'),
    // Project-specific AI logs
    'logs/ai',
    '.ai-logs',
  ];

  for (const location of knownLocations) {
    if (existsSync(location)) {
      console.log(`📂 Scanning ${location}...`);
      try {
        const files = readdirSync(location);
        for (const file of files) {
          if (file.endsWith('.json')) {
            try {
              const content = readFileSync(path.join(location, file), 'utf8');
              const data = JSON.parse(content);

              // Try to extract meaningful info from the log
              const log = createAILog({
                agent: detectAgent(location, data),
                summary: extractSummary(data),
                sessionId: data.sessionId ?? data.id,
                rawData: data,
              });
              foundLogs.push(log);
            } catch {
              // Skip invalid JSON files
            }
          }
        }
      } catch {
        // Directory not readable
      }
    }
  }

  console.log(`\n📊 Found ${foundLogs.length} AI logs`);
  return foundLogs;
}

/**
 * Detects the agent type from the location or data
 */
function detectAgent(location: string, data: Record<string, unknown>): string {
  if (location.includes('cursor')) return 'cursor';
  if (location.includes('claude')) return 'claude';
  if (data.model?.toString().includes('gpt')) return 'gpt';
  if (data.model?.toString().includes('claude')) return 'claude';
  return 'unknown';
}

/**
 * Extracts a summary from the log data
 */
function extractSummary(data: Record<string, unknown>): string {
  // Try common fields
  if (typeof data.summary === 'string') return data.summary;
  if (typeof data.title === 'string') return data.title;
  if (typeof data.description === 'string') return data.description;

  // Try to get first message
  if (Array.isArray(data.messages) && data.messages.length > 0) {
    const firstMsg = data.messages[0];
    if (typeof firstMsg === 'object' && firstMsg !== null) {
      const content = (firstMsg as Record<string, unknown>).content;
      if (typeof content === 'string') {
        return content.slice(0, 100) + (content.length > 100 ? '...' : '');
      }
    }
  }

  return 'AI agent session';
}

/**
 * Lists all saved AI logs
 */
function listAILogs(): AIAgentLog[] {
  ensureAILogsDir();
  const logs: AIAgentLog[] = [];

  try {
    const files = readdirSync(config.aiLogsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = readFileSync(path.join(config.aiLogsDir, file), 'utf8');
          logs.push(JSON.parse(content) as AIAgentLog);
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Generates a summary of AI agent activity for the current PR
 */
function generateAISummary(): string {
  const logs = listAILogs();

  if (logs.length === 0) {
    return 'No AI agent activity recorded.';
  }

  const byAgent: Record<string, number> = {};
  const allFiles = new Set<string>();
  let totalDuration = 0;

  for (const log of logs) {
    byAgent[log.agent] = (byAgent[log.agent] ?? 0) + 1;
    if (log.filesModified) {
      for (const f of log.filesModified) {
        allFiles.add(f);
      }
    }
    if (log.durationSec) {
      totalDuration += log.durationSec;
    }
  }

  const lines = [
    `### 🤖 AI Agent Activity`,
    '',
    `**Sessions:** ${logs.length}`,
    `**Agents:** ${Object.entries(byAgent).map(([a, c]) => `${a} (${c})`).join(', ')}`,
  ];

  if (allFiles.size > 0) {
    lines.push(`**Files modified:** ${allFiles.size}`);
  }

  if (totalDuration > 0) {
    lines.push(`**Total duration:** ${(totalDuration / 60).toFixed(1)} min`);
  }

  return lines.join('\n');
}

// CLI handling
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }

  // Also support environment variables (useful in CI)
  if (process.env.AI_LOG_AGENT) result.agent = process.env.AI_LOG_AGENT;
  if (process.env.AI_LOG_SUMMARY) result.summary = process.env.AI_LOG_SUMMARY;
  if (process.env.AI_LOG_SESSION) result.session = process.env.AI_LOG_SESSION;
  if (process.env.AI_LOG_FILES) result.files = process.env.AI_LOG_FILES;
  if (process.env.AI_LOG_DURATION) result.duration = process.env.AI_LOG_DURATION;
  if (process.env.AI_LOG_MESSAGES) result.messages = process.env.AI_LOG_MESSAGES;

  return result;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));

  if (args.scan) {
    scanForAILogs();
  } else if (args.list) {
    const logs = listAILogs();
    console.log('📋 AI Agent Logs:');
    for (const log of logs) {
      console.log(`  - [${log.agent}] ${log.summary} (${log.timestamp})`);
    }
  } else if (args['show-summary'] || (args.summary === true)) {
    // --show-summary or --summary (without value) shows activity summary
    console.log(generateAISummary());
  } else if (args.agent && typeof args.agent === 'string') {
    // Create a new log entry
    const log = createAILog({
      agent: args.agent,
      summary: typeof args.summary === 'string' ? args.summary : 'AI session',
      sessionId: typeof args.session === 'string' ? args.session : undefined,
      filesModified: typeof args.files === 'string' ? args.files.split(',') : undefined,
      durationSec: typeof args.duration === 'string' ? parseFloat(args.duration) : undefined,
      messageCount: typeof args.messages === 'string' ? parseInt(args.messages, 10) : undefined,
    });
    console.log('Created log:', JSON.stringify(log, null, 2));
  } else {
    console.log(`
AI Agent Logger - Collect and manage AI agent chat logs

Usage:
  npx tsx scripts/metrics/ai-logger.ts --agent <name> --summary "Description" [options]
  npx tsx scripts/metrics/ai-logger.ts --scan          # Scan for existing AI logs
  npx tsx scripts/metrics/ai-logger.ts --list          # List all saved logs
  npx tsx scripts/metrics/ai-logger.ts --show-summary  # Generate activity summary

Options:
  --agent <name>       Agent type: cursor, claude, gpt, etc.
  --summary <text>     Summary of what the agent did
  --session <id>       Session/conversation ID
  --files <list>       Comma-separated list of modified files
  --duration <sec>     Duration of the session in seconds
  --messages <count>   Number of messages in the session
    `);
  }
}

export { createAILog, scanForAILogs, listAILogs, generateAISummary };
