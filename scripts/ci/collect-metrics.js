#!/usr/bin/env node
/**
 * CI Metrics Collector (JavaScript version)
 * Collects build time, test time, bundle size, and other metrics
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = '.cache';
const METRICS_DIR = path.join(CACHE_DIR, 'metrics');
const LOGS_DIR = path.join(CACHE_DIR, 'logs');
const CURRENT_METRICS_FILE = path.join(METRICS_DIR, 'current.json');

// Ensure directories exist
fs.mkdirSync(METRICS_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

/**
 * Measure execution time of a command
 */
function measureCommand(command, logPath, options = {}) {
  const { timeout = 300000, ignoreError = true } = options;
  const start = Date.now();
  
  try {
    const output = execSync(command, {
      stdio: 'pipe',
      timeout,
      encoding: 'utf-8',
    });
    const end = Date.now();
    const duration = (end - start) / 1000;
    
    fs.writeFileSync(
      logPath,
      `Command: ${command}\nDuration: ${duration.toFixed(2)}s\nStatus: Success\n\n${output}`,
      'utf-8'
    );
    
    return duration;
  } catch (error) {
    const end = Date.now();
    const duration = (end - start) / 1000;
    
    fs.writeFileSync(
      logPath,
      `Command: ${command}\nDuration: ${duration.toFixed(2)}s\nStatus: Failed\n\nError: ${error.message}\n\nOutput:\n${error.stdout || ''}\n\nStderr:\n${error.stderr || ''}`,
      'utf-8'
    );
    
    if (!ignoreError) {
      throw error;
    }
    
    return duration;
  }
}

/**
 * Get bundle size if dist exists
 */
function getBundleSize() {
  try {
    const distPath = path.join(process.cwd(), 'dist');
    fs.accessSync(distPath);
    
    const sizeOutput = execSync(`du -sb ${distPath}`, { encoding: 'utf-8' });
    const sizeMatch = sizeOutput.match(/^(\d+)/);
    
    if (sizeMatch) {
      return parseInt(sizeMatch[1], 10);
    }
  } catch {
    // dist doesn't exist or other error
  }
  
  return 0;
}

/**
 * Get git diff statistics
 */
function getGitStats() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const baseBranch = branch === 'main' ? 'HEAD~1' : 'origin/main';
    
    try {
      const diffStat = execSync(`git diff --shortstat ${baseBranch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      
      const additionsMatch = diffStat.match(/(\d+) insertions?/);
      const deletionsMatch = diffStat.match(/(\d+) deletions?/);
      
      return {
        additions: additionsMatch ? parseInt(additionsMatch[1], 10) : 0,
        deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
      };
    } catch {
      return { additions: 0, deletions: 0 };
    }
  } catch {
    return { additions: 0, deletions: 0 };
  }
}

/**
 * Parse test results from log
 */
function parseTestResults(logPath) {
  try {
    const testLog = fs.readFileSync(logPath, 'utf-8');
    
    // Try to extract test statistics
    const passedMatch = testLog.match(/(\d+) passed/);
    const failedMatch = testLog.match(/(\d+) failed/);
    const totalMatch = testLog.match(/(\d+) tests?/);
    
    return {
      test_passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
      test_failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      test_count: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    };
  } catch {
    return {
      test_passed: 0,
      test_failed: 0,
      test_count: 0,
    };
  }
}

/**
 * Check if package.json has specific script
 */
function hasScript(scriptName) {
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    return scriptName in (packageJson.scripts || {});
  } catch {
    return false;
  }
}

/**
 * Main metrics collection
 */
function collectMetrics() {
  console.log('🚀 Starting metrics collection...\n');
  
  const metrics = {
    timestamp: new Date().toISOString(),
  };
  
  const errors = [];
  
  // Collect git stats
  console.log('📊 Collecting Git metrics...');
  try {
    const gitStats = getGitStats();
    metrics.code_additions = gitStats.additions;
    metrics.code_deletions = gitStats.deletions;
  } catch (error) {
    console.error('  ❌ Git metrics failed:', error.message);
    errors.push(`Git: ${error.message}`);
  }
  
  // Collect test metrics
  console.log('🧪 Collecting test metrics...');
  try {
    const testLogPath = path.join(LOGS_DIR, 'test.log');
    const testTime = measureCommand('npm test', testLogPath, { ignoreError: true });
    
    metrics.test_time_sec = parseFloat(testTime.toFixed(2));
    
    // Parse test results
    const testResults = parseTestResults(testLogPath);
    Object.assign(metrics, testResults);
  } catch (error) {
    console.error('  ❌ Test metrics failed:', error.message);
    errors.push(`Test: ${error.message}`);
  }
  
  // Collect build metrics (only if build script exists)
  if (hasScript('build')) {
    console.log('📦 Collecting build metrics...');
    try {
      const buildLogPath = path.join(LOGS_DIR, 'build.log');
      const buildTime = measureCommand('npm run build', buildLogPath, { ignoreError: true });
      
      metrics.build_time_sec = parseFloat(buildTime.toFixed(2));
      
      // Get bundle size
      const bundleSize = getBundleSize();
      if (bundleSize > 0) {
        metrics.bundle_size_bytes = bundleSize;
      }
    } catch (error) {
      console.error('  ❌ Build metrics failed:', error.message);
      errors.push(`Build: ${error.message}`);
    }
  } else {
    console.log('  ⚠️  No build script found, skipping build metrics');
  }
  
  // Add errors if any
  if (errors.length > 0) {
    metrics.errors = errors;
  }
  
  // Save metrics
  fs.writeFileSync(CURRENT_METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf-8');
  
  console.log('\n✅ Metrics collected successfully!');
  console.log(`📄 Saved to: ${CURRENT_METRICS_FILE}\n`);
  console.log('Summary:');
  console.log(`  Test time: ${metrics.test_time_sec?.toFixed(2) || 'N/A'} sec`);
  console.log(`  Build time: ${metrics.build_time_sec?.toFixed(2) || 'N/A'} sec`);
  console.log(`  Bundle size: ${metrics.bundle_size_bytes ? `${(metrics.bundle_size_bytes / 1024).toFixed(2)} KB` : 'N/A'}`);
  console.log(`  Code changes: +${metrics.code_additions || 0} / -${metrics.code_deletions || 0}`);
  console.log(`  Tests: ${metrics.test_passed || 0} passed, ${metrics.test_failed || 0} failed`);
  
  if (errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    errors.forEach(err => console.log(`  - ${err}`));
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    collectMetrics();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

export { collectMetrics, measureCommand, getBundleSize, getGitStats };
