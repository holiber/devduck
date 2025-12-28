#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestTiming {
  name: string;
  duration_ms: number;
  type: 'test' | 'suite';
  file?: string;
}

const rawOutput = readFileSync(join(__dirname, 'baseline-raw-output.txt'), 'utf8');
const lines = rawOutput.split('\n');

const timings: TestTiming[] = [];
let currentTest: string | null = null;
let currentFile: string | null = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Extract test/suite names
  if (line.includes('# Subtest:')) {
    currentTest = line.replace('# Subtest:', '').trim();
  }
  
  // Extract durations
  if (line.includes('duration_ms:')) {
    const duration = parseFloat(line.split('duration_ms:')[1].trim());
    const typeMatch = lines[i + 1]?.match(/type: '(test|suite)'/);
    const type = typeMatch ? typeMatch[1] as 'test' | 'suite' : 'test';
    
    if (currentTest && duration) {
      timings.push({
        name: currentTest,
        duration_ms: duration,
        type,
        file: currentFile || undefined
      });
    }
  }
  
  // Track test files
  if (line.includes('tests/installer/')) {
    const match = line.match(/tests\/installer\/[\w-]+\.test\.ts/);
    if (match) {
      currentFile = match[0];
    }
  }
}

// Calculate total and stats
const totalDuration = timings[timings.length - 1]?.duration_ms || 
  timings.filter(t => t.type === 'suite').reduce((sum, t) => sum + t.duration_ms, 0);

const testOnlyTimings = timings.filter(t => t.type === 'test');
const sorted = [...testOnlyTimings].sort((a, b) => a.duration_ms - b.duration_ms);

// Calculate fastest 20%
const top20Count = Math.ceil(testOnlyTimings.length * 0.2);
const fastest20 = sorted.slice(0, top20Count);

const timestamp = new Date().toISOString();

const baseline = {
  timestamp,
  totalDuration_ms: totalDuration,
  totalTests: testOnlyTimings.length,
  totalSuites: timings.filter(t => t.type === 'suite').length,
  testTimings: testOnlyTimings,
  fastest20: fastest20.map(t => t.name)
};

// Write JSON
writeFileSync(
  join(__dirname, 'baseline-snapshot.json'),
  JSON.stringify(baseline, null, 2)
);

// Write markdown report
const md = `# Installer Tests Baseline

**Captured:** ${timestamp}  
**Total Duration:** ${(totalDuration / 1000).toFixed(2)}s  
**Total Tests:** ${baseline.totalTests}  
**Total Suites:** ${baseline.totalSuites}

## All Test Timings (sorted by duration)

| Test Name | Duration (ms) |
|-----------|---------------|
${sorted.map(t => `| ${t.name} | ${t.duration_ms.toFixed(2)} |`).join('\n')}

## Fastest 20% (${top20Count} tests) - Smoke Group

These are the fastest ${top20Count} tests (top 20%), frozen for smoke testing:

${fastest20.map((t, i) => `${i + 1}. **${t.name}** - ${t.duration_ms.toFixed(2)}ms`).join('\n')}
`;

writeFileSync(join(__dirname, 'baseline-snapshot.md'), md);

console.log(`✅ Baseline snapshot created:`);
console.log(`   - Total duration: ${(totalDuration / 1000).toFixed(2)}s`);
console.log(`   - Total tests: ${baseline.totalTests}`);
console.log(`   - Fastest 20%: ${top20Count} tests`);
