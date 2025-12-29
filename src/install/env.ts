#!/usr/bin/env node

/**
 * Environment file setup utilities
 * 
 * Handles creation and management of .env files in workspace.
 */

import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../lib/env.js';

export interface SetupEnvFileOptions {
  autoYes?: boolean;
  log?: (msg: string) => void;
  print?: (msg: string, color?: string) => void;
  symbols?: { info: string; success: string; warning: string };
}

/**
 * Parse .env file content
 */
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse KEY="VALUE" or KEY='VALUE' or KEY=VALUE
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))?/);
    if (!match) continue;

    const key = match[1];
    const value = match[2] || match[3] || match[4] || '';
    env[key] = value;
  }

  return env;
}

/**
 * Write .env file
 */
export function writeEnvFile(filePath: string, env: Record<string, string>): void {
  const lines: string[] = [];
  
  for (const [key, value] of Object.entries(env)) {
    // Escape value if it contains spaces or special characters
    if (value.includes(' ') || value.includes('"') || value.includes("'")) {
      lines.push(`${key}="${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

/**
 * Setup .env file from workspace config
 */
export async function setupEnvFile(
  workspaceRoot: string,
  config: { env?: Array<{ name: string; default?: string; description?: string }> },
  options: SetupEnvFileOptions = {}
): Promise<void> {
  const { autoYes = false, log = () => {}, print = () => {}, symbols = { info: 'ℹ', success: '✓', warning: '⚠' } } = options;
  
  const envFile = path.join(workspaceRoot, '.env');
  
  // Check if config has env variables defined
  if (!config.env || !Array.isArray(config.env) || config.env.length === 0) {
    print(`\n${symbols.info} No environment variables defined in config, skipping .env setup`, 'cyan');
    log(`No environment variables defined in config, skipping .env setup`);
    return;
  }

  const envExists = fs.existsSync(envFile);
  if (envExists) {
    print(`\n${symbols.info} .env file exists, updating with missing variables...`, 'cyan');
    log(`.env file exists: ${envFile}, updating with missing variables`);
  } else {
    print(`\n${symbols.info} Setting up .env file...`, 'cyan');
    log(`Setting up .env file: ${envFile}`);
  }

  const env: Record<string, string> = {};
  const existingEnv: Record<string, string> = {};

  // Read existing .env if it exists
  if (envExists) {
    const existing = readEnvFile(envFile);
    Object.assign(env, existing);
    Object.assign(existingEnv, existing);
  }

  // Process each env variable from config
  const addedVars: string[] = [];
  for (const envVar of config.env) {
    const varName = envVar.name;
    const defaultValue = envVar.default || '';
    const description = envVar.description || '';

    // Skip if already set in existing .env (don't overwrite user values)
    if (existingEnv[varName]) {
      log(`Environment variable ${varName} already set in .env, skipping`);
      continue;
    }

    let value = defaultValue;

    // If not in auto-yes mode and no default, prompt user
    if (!autoYes && !defaultValue && description) {
      const { createReadlineInterface, promptUser } = await import('../utils.js');
      const rl = createReadlineInterface();
      
      try {
        const userValue = await promptUser(rl, `${description} (${varName}): `);
        value = userValue.trim();
      } finally {
        rl.close();
      }
    }

    env[varName] = value;
    addedVars.push(varName);
    log(`Set environment variable ${varName}${description ? ` (${description})` : ''}`);
  }

  // Write .env file
  writeEnvFile(envFile, env);
  if (envExists) {
    if (addedVars.length > 0) {
      print(`  ${symbols.success} Updated .env file (added ${addedVars.length} variable(s): ${addedVars.join(', ')})`, 'green');
      log(`Updated .env file: ${envFile} (added ${addedVars.join(', ')})`);
    } else {
      print(`  ${symbols.info} .env file is up to date`, 'cyan');
      log(`.env file is up to date: ${envFile}`);
    }
  } else {
    print(`  ${symbols.success} Created .env file`, 'green');
    log(`Created .env file: ${envFile}`);
  }
}

