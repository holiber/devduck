#!/usr/bin/env node

/**
 * Universal check processing function
 * 
 * Handles processing of checks from different contexts (modules, projects, etc.)
 * 
 * This function provides a unified interface for processing checks regardless of
 * their source (modules, projects, etc.). It handles:
 * - Variable substitution
 * - Skip logic
 * - Auth check validation
 * - HTTP vs command check detection
 * - Check execution
 */

import path from 'path';
import { readEnvFile } from '../lib/env.js';
import { replaceVariablesInObject } from '../lib/config.js';
import { print, symbols } from '../utils.js';
import type { CheckItem, CheckResult } from './types.js';

// Simple log function for process-check (can be overridden via options if needed)
function log(message: string): void {
  // Log to console in development, can be made configurable
  if (process.env.DEBUG) {
    console.error(`[process-check] ${message}`);
  }
}
import type { 
  CheckCommandFunction,
  CheckHttpAccessFunction,
  IsHttpRequestFunction,
  ReplaceVariablesFunction
} from './check-functions.js';

/**
 * Process a single check
 * 
 * @param contextType - Type of context: 'module', 'project', etc.
 * @param contextName - Name of the context (e.g., 'ci', 'my-project')
 * @param check - The check item to process
 * @param options - Additional options including workspace root and check functions
 * @returns Check result
 */
export async function processCheck(
  contextType: string,
  contextName: string | null,
  check: CheckItem,
  options: {
    skipInstall?: boolean;
    tier?: string;
    workspaceRoot: string;
    checkCommand: CheckCommandFunction;
    checkHttpAccess: CheckHttpAccessFunction;
    isHttpRequest: IsHttpRequestFunction;
    replaceVariablesInObjectWithLog?: ReplaceVariablesFunction;
  }
): Promise<CheckResult> {
  const { 
    skipInstall = false, 
    tier,
    workspaceRoot,
    checkCommand,
    checkHttpAccess,
    isHttpRequest,
    replaceVariablesInObjectWithLog
  } = options;
  
  // Default replace function if not provided
  const replaceVars: ReplaceVariablesFunction = replaceVariablesInObjectWithLog || ((obj: unknown, env: Record<string, string>) => {
    return replaceVariablesInObject(obj, env);
  });
  
  // Read .env file for variable substitution
  const envFile = path.join(workspaceRoot, '.env');
  const env = readEnvFile(envFile);
  
  // Get check properties BEFORE variable replacement (to preserve type and var)
  const checkType = (check as { type?: string }).type;
  const checkVar = (check as { var?: string }).var;
  const checkTest = check.test;
  
  // Handle auth checks BEFORE variable replacement
  if (checkType === 'auth') {
    // Check if test command exists
    if (!checkTest || typeof checkTest !== 'string' || !checkTest.trim()) {
      const contextSuffix = contextName ? ` [${contextName}]` : '';
      print(`Checking ${check.name}${contextSuffix}...`, 'cyan');
      log(`CHECK FAILED: ${check.name} (${contextType}: ${contextName || 'unknown'}) - auth check without test command`);
      print(`${symbols.error} ${check.name} - No test command specified for auth check`, 'red');
      if (check.description) {
        print(check.description, 'red');
      }
      const docs = (check as { docs?: string }).docs;
      if (docs) {
        print(docs, 'red');
      }
      return {
        name: check.name,
        description: check.description || '',
        passed: false,
        skipped: false,
        tier: tier,
        note: 'No test command specified for auth check'
      };
    }
    
    // For auth checks with test commands, check if token is present first
    if (!checkVar) {
      // Auth check without var property - this shouldn't happen but handle gracefully
      log(`WARNING: Auth check ${check.name} has no var property`);
    } else {
      // Check both process.env and .env file for token
      const processEnvValue = process.env[checkVar];
      const envFileValue = env[checkVar];
      
      // Get token value, prioritizing process.env over .env file
      // Note: empty strings should be treated as "not set"
      let tokenValue: string | undefined;
      if (processEnvValue !== undefined && processEnvValue !== null) {
        const trimmed = String(processEnvValue).trim();
        if (trimmed !== '') {
          tokenValue = trimmed;
        }
      }
      if (!tokenValue && envFileValue !== undefined && envFileValue !== null) {
        const trimmed = String(envFileValue).trim();
        if (trimmed !== '') {
          tokenValue = trimmed;
        }
      }
      
      // Check if token is missing or empty
      if (!tokenValue) {
        // If an install command exists and we are allowed to install, proceed to the normal
        // check flow so the check can run its install command and potentially populate `.env`.
        const installCmd = typeof check.install === 'string' ? check.install.trim() : '';
        if (installCmd && !skipInstall) {
          log(`Token ${checkVar} not set for ${check.name} - install command present, proceeding with checkCommand/install`);
        } else {
          // Token not present - skip test execution and show appropriate message
          const contextSuffix = contextName ? ` [${contextName}]` : '';
          print(`Checking ${check.name}${contextSuffix}...`, 'cyan');
          print(`${symbols.error} ${check.name} - ${checkVar} is not set`, 'red');
          if (check.description) {
            print(check.description, 'red');
          }
          const docs = (check as { docs?: string }).docs;
          if (docs) {
            print(docs, 'red');
          }
          log(`Token ${checkVar} not set for ${check.name} - skipping test`);
          return {
            name: check.name,
            description: check.description || '',
            passed: false,
            version: null,
            tier: tier,
            note: `${checkVar} is not set`
          };
        }
      }
    }
  }
  
  // Replace variables in check item (after token check)
  const checkWithVars = replaceVars(check, env) as CheckItem;
  
  // Skip check if skip=true in config
  if (checkWithVars.skip === true) {
    const contextSuffix = contextName ? ` [${contextName}]` : '';
    print(`  ${symbols.warning} ${check.name}${contextSuffix}: skipped`, 'yellow');
    log(`CHECK SKIPPED: ${check.name}${contextSuffix}`);
    return {
      name: check.name,
      description: check.description || '',
      passed: null,
      skipped: true,
      tier: tier
    };
  }
  
  // Detect check type by test format and execute
  let checkResult: CheckResult;
  if (isHttpRequest(checkWithVars.test)) {
    // HTTP access check
    checkResult = await checkHttpAccess(checkWithVars, contextName);
  } else {
    // Command/software check
    // Note: checkCommand should print "Checking..." message
    checkResult = await checkCommand(checkWithVars, contextName, skipInstall);
  }
  
  // Add tier info to result if provided
  if (tier) {
    checkResult.tier = tier;
  }
  
  return checkResult;
}

