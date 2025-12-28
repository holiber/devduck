#!/usr/bin/env node

/**
 * Script to capture baseline test timings from the current test runner
 * Outputs JSON with per-test timings and total duration
 */

import { spawnSync } from 'child_process';
import { writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface TestTiming {
  file: string;
  test: string;
  duration: number; // milliseconds
}

interface BaselineSnapshot {
  timestamp: string;
  totalDuration: number;
  testCount: number;
  installerTests: TestTiming[];
  allTests: TestTiming[];
}

function parseTestOutput(output: string, testFiles: string[]): TestTiming[] {
  const timings: TestTiming[] = [];
  const lines = output.split('\n');
  
  // TAP format parsing:
  // Each test file produces output like:
  // # Subtest: Suite Name
  //   # Subtest: Test Name
  //   ok N - Test Name
  //     ---
  //     duration_ms: 123.456
  //     ...
  
  // Track which test file we're currently processing
  let currentFileIndex = 0;
  let currentFile = testFiles[currentFileIndex] || '';
  let currentTest = '';
  let inTestBlock = false;
  let testCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect test file boundary: "1..N" indicates end of a test file's output
    // When we see a summary line, move to next file
    if (line.match(/^# tests \d+$/)) {
      currentFileIndex++;
      currentFile = testFiles[currentFileIndex] || '';
      testCount = 0;
      continue;
    }
    
    // Detect test name: "ok N - Test Name" (with indentation)
    const okMatch = line.match(/^\s+ok \d+ - (.+)$/);
    if (okMatch && currentFile) {
      currentTest = okMatch[1];
      inTestBlock = true;
      testCount++;
      continue;
    }
    
    // Detect duration in YAML block: "duration_ms: 123.456"
    if (inTestBlock && currentFile && currentTest) {
      const durationMatch = line.match(/^\s+duration_ms:\s+([\d.]+)$/);
      if (durationMatch) {
        const duration = parseFloat(durationMatch[1]);
        timings.push({
          file: currentFile.replace(/^.*\//, ''), // Just filename
          test: currentTest,
          duration: Math.round(duration) // Round to milliseconds
        });
        inTestBlock = false;
        currentTest = '';
        continue;
      }
      
      // Reset if we hit the end of the test block
      if (line.match(/^\s+\.\.\./)) {
        inTestBlock = false;
        currentTest = '';
      }
    }
  }
  
  return timings;
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

function extractTotalDuration(output: string): number {
  // Look for "# duration_ms 123.456" at the end
  const durationMatch = output.match(/# duration_ms ([\d.]+)/);
  
  if (durationMatch) {
    return parseFloat(durationMatch[1]);
  }
  
  // Fallback: sum all test durations
  return 0;
}

console.log('Finding test files...');
const allTestFiles = findTestFiles('tests');
const installerTestFiles = allTestFiles.filter(f => f.includes('installer/'));
console.log(`Found ${allTestFiles.length} total test files`);
console.log(`Found ${installerTestFiles.length} installer test files`);

console.log('Running baseline test suite...');
const startTime = Date.now();

// Run all tests
const result = spawnSync(
  'npx',
  ['tsx', '--test', '--test-concurrency=1', ...allTestFiles],
  {
    stdio: 'pipe',
    cwd: process.cwd(),
    encoding: 'utf8'
  }
);

const endTime = Date.now();
const totalDuration = endTime - startTime;
const output = result.stdout?.toString() || '';
const errorOutput = result.stderr?.toString() || '';
const fullOutput = output + '\n' + errorOutput;

// Try to extract duration from output, fallback to measured time
const reportedDuration = extractTotalDuration(fullOutput);
const finalDuration = reportedDuration > 0 ? reportedDuration : totalDuration;

console.log('Parsing test output...');
// Parse installer tests separately for better accuracy
const installerTimings: TestTiming[] = [];
for (const testFile of installerTestFiles) {
  const fileStartTime = Date.now();
  const fileResult = spawnSync(
    'npx',
    ['tsx', '--test', '--test-concurrency=1', testFile],
    {
      stdio: 'pipe',
      cwd: process.cwd(),
      encoding: 'utf8'
    }
  );
  const fileOutput = fileResult.stdout?.toString() || '';
  const fileErrorOutput = fileResult.stderr?.toString() || '';
  const fileFullOutput = fileOutput + '\n' + fileErrorOutput;
  
  const fileTimings = parseTestOutput(fileFullOutput, [testFile]);
  installerTimings.push(...fileTimings);
}

// Parse all tests (may be less accurate due to interleaved output)
const allTimings = parseTestOutput(fullOutput, allTestFiles);
// installerTimings already populated above

// Sort by duration (fastest first)
installerTimings.sort((a, b) => a.duration - b.duration);
allTimings.sort((a, b) => a.duration - b.duration);

const snapshot: BaselineSnapshot = {
  timestamp: new Date().toISOString(),
  totalDuration: finalDuration,
  testCount: allTimings.length,
  installerTests: installerTimings,
  allTests: allTimings
};

// Write JSON snapshot
const perfDir = join(process.cwd(), 'tests', 'perf');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const jsonPath = join(perfDir, `baseline-${timestamp}.json`);
const mdPath = join(perfDir, `baseline-${timestamp}.md`);

// Ensure perf directory exists
import { mkdirSync } from 'fs';
mkdirSync(perfDir, { recursive: true });

writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), 'utf8');

// Write markdown report
const mdReport = `# Baseline Test Timings

**Captured:** ${snapshot.timestamp}
**Total Duration:** ${snapshot.totalDuration}ms (${(snapshot.totalDuration / 1000).toFixed(2)}s)
**Total Tests:** ${snapshot.testCount}
**Installer Tests:** ${installerTimings.length}

## Installer Test Timings (sorted by duration)

| Test File | Test Name | Duration (ms) |
|-----------|-----------|---------------|
${installerTimings.map(t => `| ${t.file} | ${t.test} | ${t.duration} |`).join('\n')}

## Fastest 20% Installer Tests

Top ${Math.ceil(installerTimings.length * 0.2)} fastest tests:

${installerTimings.slice(0, Math.ceil(installerTimings.length * 0.2)).map((t, i) => 
  `${i + 1}. ${t.file} - ${t.test} (${t.duration}ms)`
).join('\n')}

## All Test Timings

| Test File | Test Name | Duration (ms) |
|-----------|-----------|---------------|
${allTimings.map(t => `| ${t.file} | ${t.test} | ${t.duration} |`).join('\n')}
`;

writeFileSync(mdPath, mdReport, 'utf8');

console.log(`\nBaseline snapshot saved:`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  Markdown: ${mdPath}`);
console.log(`\nTotal duration: ${finalDuration}ms`);
console.log(`Installer tests: ${installerTimings.length}`);
console.log(`Fastest 20%: ${Math.ceil(installerTimings.length * 0.2)} tests`);

if (result.status !== 0) {
  console.error('\n⚠️  Some tests failed, but baseline captured.');
  console.error('Error output:', errorOutput);
  process.exit(1);
}
