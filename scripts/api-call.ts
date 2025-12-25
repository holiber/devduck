#!/usr/bin/env node

/**
 * API call wrapper - extracts result field from API output
 * 
 * Usage:
 *   api-call <module>.<procedure> [options]
 * 
 * Examples:
 *   api-call mcp.hasTool generate_answer
 *   api-call ci.fetchPR --prId 123
 * 
 * Outputs only the result value (not the full JSON object)
 */

import { fileURLToPath } from 'url';
import { execCmd } from './lib/process.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: api-call <module>.<procedure> [options]');
    console.error('Example: api-call mcp.hasTool generate_answer');
    process.exitCode = 1;
    return;
  }

  // Call api-cli with the provided arguments
  const apiCliPath = fileURLToPath(new URL('./api-cli.ts', import.meta.url));
  const res = await execCmd('npx', ['tsx', apiCliPath, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  const exitCode = res.exitCode ?? 0;

  // If there was an error, output stderr and exit
  if (exitCode !== 0) {
    if (stderr) {
      process.stderr.write(stderr);
    }
    process.exitCode = exitCode;
    return;
  }

  // Parse JSON output and extract result
  try {
    const output = stdout.trim();
    if (!output) {
      process.exitCode = 1;
      return;
    }

    const json = JSON.parse(output);
    const result = json.result;

    // Output just the result value
    if (result === undefined || result === null) {
      // If result is not present, output the whole JSON
      process.stdout.write(output);
    } else {
      const outValue = typeof result === 'object' ? JSON.stringify(result) : String(result);
      process.stdout.write(outValue);
    }
    
    // Always add newline for clean output
    process.stdout.write('\n');
  } catch (error) {
    // If JSON parsing fails, output the raw output
    process.stdout.write(stdout);
    if (stderr) {
      process.stderr.write(stderr);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    const err = e as { message?: string; stack?: string };
    console.error(err && err.stack ? err.stack : err.message || String(e));
    process.exitCode = 1;
  });
}

export { main };

