#!/usr/bin/env node

/**
 * Test runner script that finds all test files and runs them with tsx
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from 'fs';
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

// Run tests with tsx (use npx to ensure tsx is available)
const nodeOptions = String(process.env.NODE_OPTIONS || '').trim();
const hooksImport = path.resolve('src/test-hooks.ts');
const nextNodeOptions = `${nodeOptions ? nodeOptions + ' ' : ''}--import=${hooksImport}`.trim();

const result = spawnSync(
  'npx',
  ['tsx', '--test', '--test-concurrency=1', ...testFiles],
  {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, NODE_OPTIONS: nextNodeOptions }
  }
);

process.exit(result.status ?? 1);

