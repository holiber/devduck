
import fs from 'fs';
import path from 'path';

// 1. Get all installer test files and their describe titles
const installerDir = path.join(process.cwd(), 'tests/installer');
const installerFiles = fs.readdirSync(installerDir).filter(f => f.endsWith('.test.ts'));

const installerSuites = new Map<string, string>(); // Suite/Test Name -> Filename

for (const file of installerFiles) {
  const content = fs.readFileSync(path.join(installerDir, file), 'utf8');
  // Find describe blocks
  const describeMatches = content.matchAll(/describe\(['"](.+?)['"]/g);
  for (const match of describeMatches) {
    installerSuites.set(match[1], file);
  }
  
  // Find top-level test blocks
  const testMatches = content.matchAll(/test\(['"](.+?)['"]/g);
  for (const match of testMatches) {
     installerSuites.set(match[1], file);
  }
}

console.log('Installer Test Names/Suites:', [...installerSuites.keys()]);

// 2. Parse TAP output
const tapContent = fs.readFileSync(path.join(process.cwd(), 'tests/perf/baseline_raw.txt'), 'utf8');
const lines = tapContent.split('\n');

interface TestResult {
  name: string;
  duration: number;
  suite?: string; // Parent suite
  file?: string;
}

const results: TestResult[] = [];
const suiteDurations: Record<string, number> = {};

let currentSuite: string | null = null;
let currentTest: string | null = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Detect Suite or Top-level Test
  if (line.match(/^# Subtest: (.+)$/)) {
    currentSuite = line.match(/^# Subtest: (.+)$/)![1];
    currentTest = null;
    continue;
  }

  // Detect Nested Test
  if (line.match(/^\s+# Subtest: (.+)$/)) {
    const match = line.match(/^\s+# Subtest: (.+)$/);
    if (match) {
        currentTest = match[1];
    }
    continue;
  }

  // Detect duration block
  if (line.trim().startsWith('duration_ms:')) {
    const duration = parseFloat(line.split(':')[1].trim());
    
    // If we just saw a nested test name
    if (currentTest && currentSuite) {
        results.push({
            name: currentTest,
            suite: currentSuite,
            duration: duration
        });
        currentTest = null; 
    } else if (currentSuite && !currentTest) {
        // This is a top-level item (Suite or Top-level Test)
        suiteDurations[currentSuite] = duration;
    }
  }
}

// Post-processing: Add top-level tests from suiteDurations if they are valid tests
for (const [name, duration] of Object.entries(suiteDurations)) {
    if (installerSuites.has(name)) {
        // It is associated with an installer file.
        // Check if it's already a parent of some tests in `results`
        const hasChildren = results.some(r => r.suite === name);
        if (!hasChildren) {
            // It's likely a top-level test
            results.push({
                name: name,
                suite: undefined, // Top level
                duration: duration
            });
        }
    }
}

// 3. Filter for installer tests
const installerResults = results.filter(r => {
    if (r.suite) return installerSuites.has(r.suite); // Child test of an installer suite
    if (r.name) return installerSuites.has(r.name);   // Top level test
    return false;
});

// 4. Sort by duration
installerResults.sort((a, b) => a.duration - b.duration);

// 5. Calculate total stats
const totalDuration = installerResults.reduce((acc, r) => acc + r.duration, 0);

const output = {
  timestamp: new Date().toISOString(),
  total_duration_ms: totalDuration,
  count: installerResults.length,
  tests: installerResults.map(r => ({
    ...r,
    file: (r.suite ? installerSuites.get(r.suite) : installerSuites.get(r.name)) || 'unknown'
  })),
  all_suites_found: [...installerSuites.keys()],
};

fs.writeFileSync(path.join(process.cwd(), 'tests/perf/baseline.json'), JSON.stringify(output, null, 2));
console.log(`Saved baseline to tests/perf/baseline.json. Found ${installerResults.length} installer tests.`);
