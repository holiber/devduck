#!/usr/bin/env tsx
/**
 * AI Agent Logger
 * Logs AI agent interactions and decisions during CI/CD
 */
import fs from 'fs/promises';
import path from 'path';

interface AILogEntry {
  agent: string;
  action: string;
  timestamp: string;
  context?: Record<string, any>;
  result?: string;
  metadata?: Record<string, any>;
}

interface AISession {
  session_id: string;
  started_at: string;
  ended_at?: string;
  agent_name: string;
  entries: AILogEntry[];
  summary?: string;
}

const AI_LOGS_DIR = path.join('.cache', 'ai_logs');

async function ensureAILogsDir() {
  await fs.mkdir(AI_LOGS_DIR, { recursive: true });
}

/**
 * Create a new AI session
 */
export async function createAISession(agentName: string): Promise<string> {
  await ensureAILogsDir();
  
  const sessionId = `${agentName}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const session: AISession = {
    session_id: sessionId,
    started_at: new Date().toISOString(),
    agent_name: agentName,
    entries: [],
  };
  
  const sessionPath = path.join(AI_LOGS_DIR, `${sessionId}.json`);
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  
  return sessionId;
}

/**
 * Log an AI agent action
 */
export async function logAIAction(
  sessionId: string,
  action: string,
  context?: Record<string, any>,
  result?: string
): Promise<void> {
  await ensureAILogsDir();
  
  const sessionPath = path.join(AI_LOGS_DIR, `${sessionId}.json`);
  
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const session: AISession = JSON.parse(content);
    
    const entry: AILogEntry = {
      agent: session.agent_name,
      action,
      timestamp: new Date().toISOString(),
      context,
      result,
    };
    
    session.entries.push(entry);
    
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to log AI action for session ${sessionId}:`, error);
  }
}

/**
 * End an AI session with a summary
 */
export async function endAISession(sessionId: string, summary: string): Promise<void> {
  await ensureAILogsDir();
  
  const sessionPath = path.join(AI_LOGS_DIR, `${sessionId}.json`);
  
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const session: AISession = JSON.parse(content);
    
    session.ended_at = new Date().toISOString();
    session.summary = summary;
    
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to end AI session ${sessionId}:`, error);
  }
}

/**
 * Create a simple AI log entry (for CI environments)
 */
export async function createSimpleAILog(
  agentName: string,
  summary: string,
  metadata?: Record<string, any>
): Promise<void> {
  await ensureAILogsDir();
  
  const timestamp = Date.now();
  const logEntry = {
    agent: agentName,
    summary,
    timestamp: new Date().toISOString(),
    metadata: {
      ...metadata,
      environment: 'ci',
      node_version: process.version,
    },
  };
  
  const logPath = path.join(AI_LOGS_DIR, `ai-log-${timestamp}.json`);
  await fs.writeFile(logPath, JSON.stringify(logEntry, null, 2), 'utf-8');
  
  console.log(`AI log created: ${logPath}`);
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'create-session':
      const agentName = args[1] || 'cursor-ai';
      const sessionId = await createAISession(agentName);
      console.log(`Session created: ${sessionId}`);
      break;
      
    case 'log-action':
      if (args.length < 3) {
        console.error('Usage: ai-logger.ts log-action <session_id> <action> [context_json]');
        process.exit(1);
      }
      const [, sid, action, contextJson] = args;
      const context = contextJson ? JSON.parse(contextJson) : undefined;
      await logAIAction(sid, action, context);
      console.log('Action logged');
      break;
      
    case 'end-session':
      if (args.length < 3) {
        console.error('Usage: ai-logger.ts end-session <session_id> <summary>');
        process.exit(1);
      }
      await endAISession(args[1], args[2]);
      console.log('Session ended');
      break;
      
    case 'simple-log':
      const agent = args[1] || 'cursor-ai';
      const summary = args[2] || 'CI run completed';
      const metadata = args[3] ? JSON.parse(args[3]) : undefined;
      await createSimpleAILog(agent, summary, metadata);
      break;
      
    default:
      console.log('AI Logger - Track AI agent actions in CI/CD');
      console.log('');
      console.log('Commands:');
      console.log('  create-session <agent_name>              - Create a new session');
      console.log('  log-action <session_id> <action> [ctx]   - Log an action');
      console.log('  end-session <session_id> <summary>       - End a session');
      console.log('  simple-log <agent> <summary> [metadata]  - Create a simple log');
      break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
