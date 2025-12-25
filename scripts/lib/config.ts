#!/usr/bin/env node

/**
 * Configuration file utilities
 * 
 * Provides functions for reading/writing JSON config files
 * and variable substitution in configuration objects.
 */

import fs from 'fs';

/**
 * Read JSON file
 */
export function readJSON<T = unknown>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    return null;
  }
}

/**
 * Write JSON file
 */
export function writeJSON(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Replace variables in string using $VARNAME syntax
 * Variables are resolved from process.env first, then from env parameter
 * @param str - String with variables to replace
 * @param env - Environment variables from .env file
 * @param log - Optional logging function
 * @param print - Optional print function for warnings
 * @param symbols - Optional symbols object for warnings
 */
export function replaceVariables(
  str: string,
  env: Record<string, string>,
  log?: (msg: string) => void,
  print?: (msg: string, color?: string) => void,
  symbols?: { warning: string }
): string {
  if (typeof str !== 'string') {
    return str;
  }
  
  // Replace $VAR format (preferred, non-deprecated syntax)
  let result = str.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
    // First check environment variables, then .env file
    const value = process.env[varName] || env[varName];
    if (value !== undefined) {
      return value;
    }
    // If not found, return original match with warning
    if (print && symbols && log) {
      print(`  ${symbols.warning} Variable ${match} not found, keeping as is`, 'yellow');
      log(`Warning: Variable ${match} not found in environment or .env file`);
    }
    return match;
  });
  
  // Also support deprecated $$VAR$$ format for backward compatibility
  result = result.replace(/\$\$([A-Za-z_][A-Za-z0-9_]*)\$\$/g, (match, varName) => {
    // First check environment variables, then .env file
    const value = process.env[varName] || env[varName];
    if (value !== undefined) {
      return value;
    }
    // If not found, return original match with warning
    if (print && symbols && log) {
      print(`  ${symbols.warning} Variable ${match} not found, keeping as is`, 'yellow');
      log(`Warning: Variable ${match} not found in environment or .env file`);
    }
    return match;
  });
  
  // Expand ~ to home directory
  if (result.includes('~/')) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    result = result.replace(/~/g, homeDir);
  }
  
  return result;
}

/**
 * Recursively replace variables in object
 * @param obj - Object with variables to replace
 * @param env - Environment variables from .env file
 * @param log - Optional logging function
 * @param print - Optional print function for warnings
 * @param symbols - Optional symbols object for warnings
 */
export function replaceVariablesInObject<T>(
  obj: T,
  env: Record<string, string>,
  log?: (msg: string) => void,
  print?: (msg: string, color?: string) => void,
  symbols?: { warning: string }
): T {
  if (typeof obj === 'string') {
    return replaceVariables(obj, env, log, print, symbols) as T;
  } else if (Array.isArray(obj)) {
    return obj.map(item => replaceVariablesInObject(item, env, log, print, symbols)) as T;
  } else if (obj !== null && typeof obj === 'object') {
    const result = {} as T;
    for (const [key, value] of Object.entries(obj)) {
      (result as Record<string, unknown>)[key] = replaceVariablesInObject(value, env, log, print, symbols);
    }
    return result;
  }
  return obj;
}

