#!/usr/bin/env node

import readline from 'readline';
import type { Readline } from 'readline';
import { execShellSync } from './lib/process.js';

// ANSI color codes
export const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
} as const;

// Symbols
export const symbols = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  search: '🔍',
  check: '✅',
  file: '📝',
  log: '📋'
} as const;

export type Color = keyof typeof colors;

export interface ExecuteCommandOptions {
  encoding?: BufferEncoding;
  shell?: string | boolean;
  stdio?: Array<'pipe' | 'ignore' | 'inherit'> | 'pipe' | 'ignore' | 'inherit';
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ExecuteCommandResult {
  success: boolean;
  output: string;
  error: string | null;
}

export interface ExecuteInteractiveCommandResult {
  success: boolean;
  output: null;
  error: string | null;
}

/**
 * Print colored message to console
 */
export function print(message: string, color: Color = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Execute command and return output
 * @param command - Command to execute
 * @param optionsOrShell - Options object or shell string (for backward compatibility)
 * @returns Result object with success, output, and error fields
 */
export function executeCommand(
  command: string,
  optionsOrShell: ExecuteCommandOptions | string = {}
): ExecuteCommandResult {
  try {
    // Handle backward compatibility: if second param is a string, treat it as shell
    let options: ExecuteCommandOptions;
    if (typeof optionsOrShell === 'string') {
      // Legacy mode: string parameter means shell
      options = {
        encoding: 'utf8',
        shell: optionsOrShell,
        stdio: ['ignore', 'pipe', 'pipe']
      };
    } else {
      // Modern mode: options object
      options = {
        encoding: 'utf8',
        stdio: optionsOrShell.stdio || ['pipe', 'pipe', 'pipe'],
        ...optionsOrShell
      };
    }

    const res = execShellSync(command, {
      ...options,
      // Keep execSync-like semantics for these helpers.
      // execa uses `shell: true` by default in execShellSync().
      shell: options.shell ?? true
    });
    if (res.exitCode !== 0) {
      return { success: false, output: (res.stdout || '').trim(), error: (res.stderr || '').trim() || 'Command failed' };
    }
    return {
      success: true,
      output: (res.stdout || '').trim(),
      error: null
    };
  } catch (error: unknown) {
    const err = error as { message?: string };
    return {
      success: false,
      output: '',
      error: err.message || 'Unknown error'
    };
  }
}

/**
 * Ask user for input (promise-based)
 * @param question - Question to ask
 * @returns User's answer
 */
export function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Create readline interface for user input
 * @returns Readline interface
 */
export function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input using existing readline interface
 * @param rl - Readline interface
 * @param question - Question to ask
 * @returns User's answer
 */
export function promptUser(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Check if command requires sudo
 * @param command - Command to check
 * @returns True if command starts with sudo
 */
export function requiresSudo(command: string): boolean {
  if (!command) return false;
  return command.trim().startsWith('sudo ');
}

/**
 * Execute interactive command (for sudo commands that need password input)
 * Uses stdio: 'inherit' to allow terminal interaction
 * @param command - Command to execute
 * @returns Result object with success and error fields (no output capture)
 */
export function executeInteractiveCommand(command: string): ExecuteInteractiveCommandResult {
  try {
    const res = execShellSync(command, { stdio: 'inherit' });

    return {
      success: res.exitCode === 0,
      output: null, // Cannot capture output with stdio: 'inherit'
      error: res.exitCode === 0 ? null : `Exit code: ${res.exitCode}`
    };
  } catch (error: unknown) {
    const err = error as { message?: string };
    return {
      success: false,
      output: null,
      error: err.message || 'Unknown error'
    };
  }
}

