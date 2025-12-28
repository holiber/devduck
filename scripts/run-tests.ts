#!/usr/bin/env node

/**
 * Unified test runner for DevDuck.
 *
 * - Runs Node.js `node:test` suites (`*.test.ts`) via `tsx --test`
 * - Runs Playwright suites (`*.pw.spec.ts`) via `playwright test`
 */

import { spawnSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import path from 'node:path';

function findFilesBySuffix(dir: string, suffix: string, files: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      findFilesBySuffix(fullPath, suffix, files);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(fullPath);
    }
  }
  
  return files;
}

const nodeTestFiles = findFilesBySuffix('tests', '.test.ts');
const pwTestFiles = findFilesBySuffix('tests', '.pw.spec.ts');
const pwInstallerFiles = pwTestFiles.filter((p) => p.includes(`${path.sep}installer${path.sep}`));
const pwUnitFiles = pwTestFiles.filter((p) => !p.includes(`${path.sep}installer${path.sep}`));

console.log(`Found ${nodeTestFiles.length} node:test files (*.test.ts)`);
console.log(`Found ${pwTestFiles.length} Playwright files (*.pw.spec.ts)`);
console.log(`- ${pwUnitFiles.length} unit pw specs (non-installer)`);
console.log(`- ${pwInstallerFiles.length} installer pw specs`);

if (nodeTestFiles.length === 0 && pwTestFiles.length === 0) {
  console.error('No test files found (expected *.test.ts or *.pw.spec.ts under ./tests)');
  process.exit(1);
}

function run(cmd: string, args: string[], title: string): number {
  console.log(`\n=== ${title} ===`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: process.cwd() });
  return result.status ?? 1;
}

// 1) Run node:test suites
if (nodeTestFiles.length > 0) {
  const status = run('npx', ['tsx', '--test', '--test-concurrency=1', ...nodeTestFiles], 'node:test (tsx --test)');
  if (status !== 0) process.exit(status);
}

// 2) Run Playwright suites (repo-level config covers all *.pw.spec.ts, including installer)
if (pwTestFiles.length > 0) {
  const status = run('npx', ['playwright', 'test', '-c', 'playwright.config.ts'], 'playwright test');
  if (status !== 0) process.exit(status);
}

process.exit(0);

