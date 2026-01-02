#!/usr/bin/env node

/**
 * Test runner script that finds all test files and runs them with tsx
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'fs';
import path from 'node:path';

function findTestFiles(dir: string, testFiles: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      findTestFiles(fullPath, testFiles);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      testFiles.push(fullPath);
    }
  }
  
  return testFiles;
}

function ensureWorkspaceSymlink(pkgName: string, targetRel: string): void {
  const scopeDir = path.join('node_modules', '@barducks');
  const linkPath = path.join(scopeDir, pkgName);
  const target = path.resolve(targetRel);

  if (existsSync(linkPath)) return;
  if (!existsSync(target)) return;

  mkdirSync(scopeDir, { recursive: true });
  try {
    symlinkSync(target, linkPath, 'dir');
  } catch {
    // best-effort: if symlink creation fails, let runtime throw a clear module not found error
  }
}

// In some environments npm workspaces links may be missing; make CI tests more robust.
ensureWorkspaceSymlink('sdk', 'packages/sdk');
ensureWorkspaceSymlink('test-utils', 'packages/test-utils');

// Always clean artifacts from previous runs.
const artifactsDir = path.join(process.cwd(), '.cache', 'artifacts');
if (existsSync(artifactsDir)) {
  try {
    rmSync(artifactsDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

const roots = process.argv.slice(2).filter((a) => a && !a.startsWith('-'));
const searchRoots = roots.length > 0 ? roots : ['tests', 'extensions'];
const testFiles = searchRoots.flatMap((r) => findTestFiles(r));
console.log(`Found ${testFiles.length} test files`);

if (testFiles.length === 0) {
  console.error('No test files found');
  process.exit(1);
}

// Run tests with Node's built-in test runner, using tsx loader for TS support.
// This avoids subtle boot-order issues with `npx tsx --test` + NODE_OPTIONS preloads.
const timeoutMs = Number(process.env.BARDUCKS_TEST_TIMEOUT_MS || 10 * 60_000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('Invalid BARDUCKS_TEST_TIMEOUT_MS, must be a positive number (ms)');
  process.exit(1);
}

const args = [
  '--import',
  'tsx',
  '--import',
  '@barducks/test-utils/node-test-hooks',
  '--test',
  '--test-concurrency=1',
  ...testFiles
];

const result = spawnSync('node', args, {
  stdio: 'inherit',
  cwd: process.cwd(),
  timeout: timeoutMs,
  killSignal: 'SIGKILL'
});

if (result.error && (result.error as any).code === 'ETIMEDOUT') {
  console.error(`\nERROR: unit tests timed out after ${timeoutMs}ms (BARDUCKS_TEST_TIMEOUT_MS)\n`);
  process.exit(124);
}

process.exit(result.status ?? 1);

