#!/usr/bin/env node

/**
 * Test runner script that finds all test files and runs them with tsx
 */

import { spawnSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

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

// Run tests with local tsx binary (faster than npx).
const TSX_BIN = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

const result = spawnSync(TSX_BIN, ['--test', '--test-concurrency=1', ...testFiles], {
  stdio: 'inherit',
  cwd: process.cwd()
});

process.exit(result.status ?? 1);

