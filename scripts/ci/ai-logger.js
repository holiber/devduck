#!/usr/bin/env node
/**
 * AI Agent Logger (JavaScript version)
 * Logs AI agent interactions during development and CI/CD
 */
import fs from 'fs';
import path from 'path';

const AI_LOGS_DIR = path.join('.cache', 'ai_logs');

async function ensureAILogsDir() {
  if (!fs.existsSync(AI_LOGS_DIR)) {
    fs.mkdirSync(AI_LOGS_DIR, { recursive: true });
  }
}

/**
 * Create a simple AI log entry (for CI environments)
 */
function createSimpleLog(agentName, summary, metadata) {
  ensureAILogsDir();
  
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
  fs.writeFileSync(logPath, JSON.stringify(logEntry, null, 2), 'utf-8');
  
  console.log(`AI log created: ${logPath}`);
}

/**
 * CLI interface
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'simple-log':
      const agent = args[1] || 'cursor-ai';
      const summary = args[2] || 'CI run completed';
      let metadata = {};
      
      if (args[3]) {
        try {
          metadata = JSON.parse(args[3]);
        } catch (error) {
          console.error('Error parsing metadata JSON:', error.message);
          process.exit(1);
        }
      }
      
      createSimpleLog(agent, summary, metadata);
      break;
      
    default:
      console.log('AI Logger - Track AI agent actions in CI/CD');
      console.log('');
      console.log('Usage:');
      console.log('  node scripts/ci/ai-logger.js simple-log <agent> <summary> [metadata_json]');
      console.log('');
      console.log('Example:');
      console.log('  node scripts/ci/ai-logger.js simple-log "cursor-ai" "PR analysis done" \'{"pr":123}\'');
      break;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { createSimpleLog };
