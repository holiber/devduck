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

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: api-call <module>.<procedure> [options]');
    console.error('Example: api-call mcp.hasTool generate_answer');
    process.exitCode = 1;
    return;
  }

  // Call api-cli with the provided arguments
  const apiCliPath = path.join(__dirname, 'api-cli.ts');
  const apiProcess = spawn('npx', ['tsx', apiCliPath, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false
  });

  let stdout = '';
  let stderr = '';

  apiProcess.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  apiProcess.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const exitCode = await new Promise<number>((resolve) => {
    apiProcess.on('close', (code) => {
      resolve(code || 0);
    });
  });

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
      // Output the result value directly
      if (typeof result === 'string') {
        process.stdout.write(result);
      } else if (typeof result === 'boolean') {
        process.stdout.write(result.toString());
      } else if (typeof result === 'number') {
        process.stdout.write(result.toString());
      } else {
        // For objects/arrays, output as JSON
        process.stdout.write(JSON.stringify(result));
      }
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

