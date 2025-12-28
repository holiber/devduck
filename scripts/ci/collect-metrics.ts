#!/usr/bin/env tsx
/**
 * CI Metrics Collector
 * Collects build time, test time, bundle size, and other metrics for PR analysis
 */
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

interface Metrics {
  timestamp: string;
  build_time_sec?: number;
  test_time_sec?: number;
  test_count?: number;
  test_passed?: number;
  test_failed?: number;
  bundle_size_bytes?: number;
  code_additions?: number;
  code_deletions?: number;
  playwright_tests?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  errors?: string[];
}

const CACHE_DIR = '.cache';
const METRICS_DIR = path.join(CACHE_DIR, 'metrics');
const LOGS_DIR = path.join(CACHE_DIR, 'logs');
const METRICS_FILE = path.join(METRICS_DIR, 'metrics.json');

async function ensureDirectories() {
  await fs.mkdir(METRICS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
}

function runAndMeasure(
  command: string,
  logPath: string,
  options: { timeout?: number; ignoreError?: boolean } = {}
): number | undefined {
  const { timeout = 300000, ignoreError = false } = options;
  const start = Date.now();
  
  try {
    const output = execSync(command, {
      stdio: 'pipe',
      timeout,
      encoding: 'utf-8',
    });
    const end = Date.now();
    const duration = (end - start) / 1000;
    
    fs.writeFile(
      logPath,
      `Command: ${command}\nDuration: ${duration.toFixed(2)}s\nStatus: Success\n\n${output}`,
      'utf-8'
    ).catch(console.error);
    
    return duration;
  } catch (error: any) {
    const end = Date.now();
    const duration = (end - start) / 1000;
    
    fs.writeFile(
      logPath,
      `Command: ${command}\nDuration: ${duration.toFixed(2)}s\nStatus: Failed\n\nError: ${error.message}\n\nOutput:\n${error.stdout || ''}\n\nStderr:\n${error.stderr || ''}`,
      'utf-8'
    ).catch(console.error);
    
    if (!ignoreError) {
      throw error;
    }
    
    return duration;
  }
}

async function collectBuildMetrics(metrics: Metrics): Promise<void> {
  console.log('📦 Collecting build metrics...');
  
  try {
    // Check if there's a build script
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8'));
    
    if (packageJson.scripts?.build) {
      metrics.build_time_sec = runAndMeasure(
        'npm run build',
        path.join(LOGS_DIR, 'build.log'),
        { ignoreError: true }
      );
    }
    
    // Measure bundle size if dist exists
    try {
      const distPath = path.join(process.cwd(), 'dist');
      await fs.access(distPath);
      
      const sizeOutput = execSync(`du -sb ${distPath}`, { encoding: 'utf-8' });
      const sizeMatch = sizeOutput.match(/^(\d+)/);
      if (sizeMatch) {
        metrics.bundle_size_bytes = parseInt(sizeMatch[1], 10);
      }
    } catch {
      console.log('  ⚠️  No dist directory found, skipping bundle size');
    }
  } catch (error: any) {
    console.error('  ❌ Build metrics collection failed:', error.message);
    metrics.errors = metrics.errors || [];
    metrics.errors.push(`Build: ${error.message}`);
  }
}

async function collectTestMetrics(metrics: Metrics): Promise<void> {
  console.log('🧪 Collecting test metrics...');
  
  try {
    const testLogPath = path.join(LOGS_DIR, 'test.log');
    metrics.test_time_sec = runAndMeasure(
      'npm test',
      testLogPath,
      { ignoreError: true }
    );
    
    // Parse test results from log
    try {
      const testLog = await fs.readFile(testLogPath, 'utf-8');
      
      // Try to extract test statistics
      const passedMatch = testLog.match(/(\d+) passed/);
      const failedMatch = testLog.match(/(\d+) failed/);
      const totalMatch = testLog.match(/(\d+) tests?/);
      
      if (passedMatch) metrics.test_passed = parseInt(passedMatch[1], 10);
      if (failedMatch) metrics.test_failed = parseInt(failedMatch[1], 10);
      if (totalMatch) metrics.test_count = parseInt(totalMatch[1], 10);
    } catch {
      // Parsing failed, but that's okay
    }
  } catch (error: any) {
    console.error('  ❌ Test metrics collection failed:', error.message);
    metrics.errors = metrics.errors || [];
    metrics.errors.push(`Test: ${error.message}`);
  }
}

async function collectPlaywrightMetrics(metrics: Metrics): Promise<void> {
  console.log('🎭 Collecting Playwright metrics...');
  
  try {
    // Check if Playwright is configured
    const pwConfigExists = await fs.access('tests/installer/playwright.config.ts')
      .then(() => true)
      .catch(() => false);
    
    if (!pwConfigExists) {
      console.log('  ⚠️  Playwright not configured, skipping');
      return;
    }
    
    // This will be run separately in the CI workflow
    // Just check if results exist
    try {
      const resultsPath = path.join(process.cwd(), 'test-results');
      await fs.access(resultsPath);
      
      // Count test results
      const entries = await fs.readdir(resultsPath, { withFileTypes: true });
      const testDirs = entries.filter(e => e.isDirectory());
      
      metrics.playwright_tests = {
        total: testDirs.length,
        passed: 0,
        failed: 0,
        skipped: 0,
      };
      
      // Try to determine pass/fail from directory structure
      for (const dir of testDirs) {
        const dirPath = path.join(resultsPath, dir.name);
        const files = await fs.readdir(dirPath);
        
        if (files.some(f => f.includes('fail') || f.includes('diff'))) {
          metrics.playwright_tests.failed++;
        } else {
          metrics.playwright_tests.passed++;
        }
      }
    } catch {
      console.log('  ⚠️  No Playwright results found');
    }
  } catch (error: any) {
    console.error('  ❌ Playwright metrics collection failed:', error.message);
  }
}

async function collectGitMetrics(metrics: Metrics): Promise<void> {
  console.log('📊 Collecting Git metrics...');
  
  try {
    // Get current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    
    // Get diff stats against main/master
    const baseBranch = branch === 'main' ? 'HEAD~1' : 'origin/main';
    
    try {
      const diffStat = execSync(`git diff --shortstat ${baseBranch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      
      const additionsMatch = diffStat.match(/(\d+) insertions?/);
      const deletionsMatch = diffStat.match(/(\d+) deletions?/);
      
      if (additionsMatch) metrics.code_additions = parseInt(additionsMatch[1], 10);
      if (deletionsMatch) metrics.code_deletions = parseInt(deletionsMatch[1], 10);
    } catch {
      console.log('  ⚠️  Could not determine diff stats');
    }
  } catch (error: any) {
    console.error('  ❌ Git metrics collection failed:', error.message);
  }
}

async function main() {
  console.log('🚀 Starting metrics collection...\n');
  
  await ensureDirectories();
  
  const metrics: Metrics = {
    timestamp: new Date().toISOString(),
  };
  
  // Collect all metrics
  await collectGitMetrics(metrics);
  await collectTestMetrics(metrics);
  await collectBuildMetrics(metrics);
  await collectPlaywrightMetrics(metrics);
  
  // Save metrics
  await fs.writeFile(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf-8');
  
  console.log('\n✅ Metrics collected successfully!');
  console.log(`📄 Saved to: ${METRICS_FILE}\n`);
  console.log('Summary:');
  console.log(`  Test time: ${metrics.test_time_sec?.toFixed(2) || 'N/A'} sec`);
  console.log(`  Build time: ${metrics.build_time_sec?.toFixed(2) || 'N/A'} sec`);
  console.log(`  Bundle size: ${metrics.bundle_size_bytes ? `${(metrics.bundle_size_bytes / 1024).toFixed(2)} KB` : 'N/A'}`);
  console.log(`  Code changes: +${metrics.code_additions || 0} / -${metrics.code_deletions || 0}`);
  
  if (metrics.errors && metrics.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    metrics.errors.forEach(err => console.log(`  - ${err}`));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { collectBuildMetrics, collectTestMetrics, collectPlaywrightMetrics, collectGitMetrics };
