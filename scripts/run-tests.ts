#!/usr/bin/env node

/**
 * Test runner script that finds all test files and runs them with tsx
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execCmdSync } from './lib/process.js';

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

// Run tests with tsx (use npx to ensure tsx is available)
const result = execCmdSync('npx', ['tsx', '--test', ...testFiles], {
  stdio: 'inherit',
  cwd: process.cwd()
});

process.exit(result.exitCode ?? 1);

