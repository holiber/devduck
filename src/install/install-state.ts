#!/usr/bin/env node

/**
 * Installation state management
 * 
 * Manages unified install-state.json file that tracks:
 * - Step completion status
 * - Check execution history
 * - Installation results
 */

import fs from 'fs';
import path from 'path';
import { readJSON, writeJSON } from '../lib/config.js';
import type { CheckResult } from './types.js';

export interface CheckEnvResult {
  present: string[];
  missing: string[];
  optional: string[];
  validationStatus: 'ok' | 'needs_input' | 'failed';
}

export interface RepoResult {
  url: string;
  path: string;
  success: boolean;
  error?: string;
}

export interface ProjectResult {
  name: string;
  src: string | undefined;
  symlink: {
    path: string | null;
    target: string | null;
    created?: boolean;
    existed?: boolean;
    error?: string;
  } | null;
  checks: CheckResult[];
}

export interface ModuleResult {
  name: string;
  path: string;
  checks: CheckResult[];
  hooksExecuted: {
    'pre-install': boolean;
    'install': boolean;
    'post-install': boolean;
  };
}

export interface VerificationResult extends CheckResult {
  step: string;
  executedAt: string;
}

export interface StepResult {
  completed: boolean;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface InstallState {
  // Step completion
  steps: {
    'check-env': StepResult;
    'download-repos': StepResult;
    'download-projects': StepResult;
    'check-env-again': StepResult;
    'setup-modules': StepResult;
    'setup-projects': StepResult;
    'verify-installation': StepResult;
  };
  
  // Check execution tracking
  executedChecks: Array<{
    checkId: string;
    step: string;
    passed: boolean | null;
    executedAt: string;
    checkName?: string;
  }>;
  
  // Additional data
  installedModules?: Record<string, string>;
  installedAt?: string;
  mcpServers?: unknown[];
  checks?: CheckResult[];
  projects?: ProjectResult[];
}

const DEFAULT_STATE: InstallState = {
  steps: {
    'check-env': { completed: false },
    'download-repos': { completed: false },
    'download-projects': { completed: false },
    'check-env-again': { completed: false },
    'setup-modules': { completed: false },
    'setup-projects': { completed: false },
    'verify-installation': { completed: false }
  },
  executedChecks: []
};

/**
 * Get path to install-state.json file
 */
export function getInstallStatePath(workspaceRoot: string): string {
  const cacheDir = path.join(workspaceRoot, '.cache');
  return path.join(cacheDir, 'install-state.json');
}

/**
 * Load installation state from file
 */
export function loadInstallState(workspaceRoot: string): InstallState {
  const statePath = getInstallStatePath(workspaceRoot);
  
  if (!fs.existsSync(statePath)) {
    return { ...DEFAULT_STATE };
  }
  
  try {
    const state = readJSON<InstallState>(statePath);
    if (!state) {
      return { ...DEFAULT_STATE };
    }
    
    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_STATE,
      ...state,
      steps: {
        ...DEFAULT_STATE.steps,
        ...(state.steps || {})
      },
      executedChecks: state.executedChecks || []
    };
  } catch (error) {
    const err = error as Error;
    console.warn(`Failed to load install state: ${err.message}`);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Save installation state to file
 */
export function saveInstallState(workspaceRoot: string, state: InstallState): void {
  const statePath = getInstallStatePath(workspaceRoot);
  const cacheDir = path.dirname(statePath);
  
  // Ensure cache directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  writeJSON(statePath, state);
}

/**
 * Mark a step as completed
 */
export function markStepCompleted<T>(
  workspaceRoot: string,
  stepName: keyof InstallState['steps'],
  result?: unknown,
  error?: string
): void {
  const state = loadInstallState(workspaceRoot);
  
  state.steps[stepName] = {
    completed: true,
    completedAt: new Date().toISOString(),
    result,
    error
  };
  
  saveInstallState(workspaceRoot, state);
}

/**
 * Check if a step is completed
 */
export function isStepCompleted(
  workspaceRoot: string,
  stepName: keyof InstallState['steps']
): boolean {
  const state = loadInstallState(workspaceRoot);
  return state.steps[stepName]?.completed === true;
}

/**
 * Track check execution
 */
export function trackCheckExecution(
  workspaceRoot: string,
  checkId: string,
  step: string,
  result: CheckResult
): void {
  const state = loadInstallState(workspaceRoot);
  
  // Remove existing entry for this check if it exists
  state.executedChecks = state.executedChecks.filter(
    c => c.checkId !== checkId
  );
  
  // Add new entry
  state.executedChecks.push({
    checkId,
    step,
    passed: result.passed,
    executedAt: new Date().toISOString(),
    checkName: result.name
  });
  
  saveInstallState(workspaceRoot, state);
}

/**
 * Get list of executed checks
 */
export function getExecutedChecks(workspaceRoot: string): Array<{
  checkId: string;
  step: string;
  passed: boolean | null;
  executedAt: string;
  checkName?: string;
}> {
  const state = loadInstallState(workspaceRoot);
  return state.executedChecks;
}

/**
 * Check if a check has been executed
 */
export function isCheckExecuted(workspaceRoot: string, checkId: string): boolean {
  const state = loadInstallState(workspaceRoot);
  return state.executedChecks.some(c => c.checkId === checkId);
}

/**
 * Generate check ID from check item
 */
export function generateCheckId(check: { name: string; type?: string; var?: string; test?: string }): string {
  // Use name as primary identifier
  // Add type and var for uniqueness if available
  const parts = [check.name];
  if (check.type) {
    parts.push(check.type);
  }
  if (check.var) {
    parts.push(check.var);
  }
  return parts.join('::');
}

