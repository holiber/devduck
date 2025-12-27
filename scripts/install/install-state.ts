#!/usr/bin/env node

/**
 * Unified installer state persisted in `.cache/install-state.json`.
 *
 * This file replaces legacy caches:
 * - `.cache/install-check.json`
 * - `.cache/pre-install-check.json`
 */

import fs from 'fs';
import path from 'path';
import { readJSON, writeJSON } from '../lib/config.js';

export type InstallStepKey =
  | 'check-env'
  | 'download-repos'
  | 'download-projects'
  | 'check-env-again'
  | 'setup-modules'
  | 'setup-projects'
  | 'verify-installation';

export interface EnvRequirement {
  name: string;
  description?: string;
  optional?: boolean;
  source: string;
}

export interface CheckEnvResult {
  present: string[];
  missing: string[];
  optionalMissing: string[];
  requirements: EnvRequirement[];
}

export interface RepoResult {
  repoUrl: string;
  path: string;
  ok: boolean;
  error?: string;
}

export interface ProjectLinkResult {
  name: string;
  src?: string;
  path?: string;
  ok: boolean;
  kind: 'symlink' | 'git-clone' | 'noop' | 'error';
  error?: string;
}

export interface CheckExecutionRecord {
  checkId: string;
  step: InstallStepKey;
  passed: boolean | null;
  executedAt: string;
}

export interface InstallStateStep<T = unknown> {
  completed: boolean;
  completedAt?: string;
  result?: T;
}

export interface InstallState {
  steps: Record<InstallStepKey, InstallStateStep>;
  executedChecks: CheckExecutionRecord[];

  // Cached Arcadia root (used by repo loaders / project linking).
  arcadiaRoot?: string;

  installedAt?: string;
  installedModules?: Record<string, string>;
  mcpServers?: unknown[];
  checks?: unknown[];
  projects?: unknown[];

  // Legacy: results produced by `scripts/install/pre-install-check.ts` (kept for tests/tools).
  preInstallCheck?: unknown;
}

export function getInstallStatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.cache', 'install-state.json');
}

export function createEmptyInstallState(): InstallState {
  const emptyStep = (): InstallStateStep => ({ completed: false });
  return {
    steps: {
      'check-env': emptyStep(),
      'download-repos': emptyStep(),
      'download-projects': emptyStep(),
      'check-env-again': emptyStep(),
      'setup-modules': emptyStep(),
      'setup-projects': emptyStep(),
      'verify-installation': emptyStep()
    },
    executedChecks: []
  };
}

export function readInstallState(workspaceRoot: string): InstallState {
  const p = getInstallStatePath(workspaceRoot);
  const parsed = readJSON(p) as InstallState | null;
  if (!parsed || typeof parsed !== 'object') {
    return createEmptyInstallState();
  }

  // Best-effort normalization for partially-written files.
  const empty = createEmptyInstallState();
  const steps = (parsed as InstallState).steps && typeof (parsed as InstallState).steps === 'object'
    ? { ...empty.steps, ...(parsed as InstallState).steps }
    : empty.steps;

  return {
    ...empty,
    ...parsed,
    steps,
    executedChecks: Array.isArray((parsed as InstallState).executedChecks) ? (parsed as InstallState).executedChecks : []
  };
}

export function writeInstallState(workspaceRoot: string, state: InstallState): void {
  const cacheDir = path.join(workspaceRoot, '.cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  writeJSON(getInstallStatePath(workspaceRoot), state);
}

export function updateInstallStep<T>(
  workspaceRoot: string,
  step: InstallStepKey,
  patch: { completed?: boolean; result?: T }
): InstallState {
  const state = readInstallState(workspaceRoot);
  const existing = state.steps[step] || { completed: false };
  const completed = patch.completed ?? existing.completed;
  const next: InstallState = {
    ...state,
    steps: {
      ...state.steps,
      [step]: {
        ...existing,
        ...patch,
        completed,
        completedAt: completed ? new Date().toISOString() : existing.completedAt
      }
    }
  };
  writeInstallState(workspaceRoot, next);
  return next;
}

export function trackExecutedCheck(
  workspaceRoot: string,
  record: Omit<CheckExecutionRecord, 'executedAt'> & { executedAt?: string }
): InstallState {
  const state = readInstallState(workspaceRoot);
  const next: InstallState = {
    ...state,
    executedChecks: [
      ...(state.executedChecks || []),
      {
        ...record,
        executedAt: record.executedAt || new Date().toISOString()
      }
    ]
  };
  writeInstallState(workspaceRoot, next);
  return next;
}

export function getExecutedChecks(state: InstallState): Set<string> {
  const s = new Set<string>();
  for (const rec of state.executedChecks || []) {
    if (rec && typeof rec.checkId === 'string') s.add(rec.checkId);
  }
  return s;
}

