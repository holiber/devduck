#!/usr/bin/env node

/**
 * Test runner script that finds all test files and runs them with tsx
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function ensureWorkspacePackageLinks(): void {
  // Some environments run tests without workspace linking (no node_modules/@barducks/*).
  // Many extensions import from '@barducks/sdk', so make it resolvable for tests.
  try {
    const repoRoot = process.cwd(); // projects/barducks
    const nmScopeDir = path.join(repoRoot, 'node_modules', '@barducks');
    fs.mkdirSync(nmScopeDir, { recursive: true });

    const links: Array<{ name: string; targetRel: string }> = [
      { name: 'sdk', targetRel: '../../packages/sdk' },
      { name: 'core', targetRel: '../../packages/core' },
      { name: 'cli', targetRel: '../../packages/cli' },
      { name: 'test-utils', targetRel: '../../packages/test-utils' }
    ];

    for (const l of links) {
      const linkPath = path.join(nmScopeDir, l.name);

      // If it already exists (real dir or symlink), keep it.
      try {
        if (fs.existsSync(linkPath)) continue;
      } catch {
        // ignore
      }

      // Prefer relative symlink (portable within repo).
      try {
        fs.symlinkSync(l.targetRel, linkPath, 'dir');
      } catch {
        // Windows fallback (best-effort).
        try {
          fs.symlinkSync(l.targetRel, linkPath, 'junction');
        } catch {
          // Ignore; tests may still pass if npm properly linked workspaces.
        }
      }
    }
  } catch {
    // Ignore; tests may still pass if npm properly linked workspaces.
  }
}

function findTestFiles(dir: string, testFiles: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      findTestFiles(fullPath, testFiles);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      testFiles.push(fullPath);
    }
  }
  
  return testFiles;
}

const testFiles = findTestFiles('tests');
console.log(`Found ${testFiles.length} test files`);

if (testFiles.length === 0) {
  console.error('No test files found');
  process.exit(1);
}

ensureWorkspacePackageLinks();

// Run tests with tsx (use npx to ensure tsx is available)
const result = spawnSync(
  'npx',
  ['tsx', '--test', '--test-concurrency=1', ...testFiles],
  {
    stdio: 'inherit',
    cwd: process.cwd()
  }
);

process.exit(result.status ?? 1);

