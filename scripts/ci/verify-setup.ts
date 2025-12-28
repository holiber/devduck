#!/usr/bin/env tsx
/**
 * Verify CI Metrics System Setup
 * Checks if all required files and configurations are in place
 */
import fs from 'fs/promises';
import path from 'path';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

const results: CheckResult[] = [];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkWorkflowFiles(): Promise<void> {
  console.log('📋 Checking workflow files...');

  const files = [
    '.github/workflows/pr-metrics.yml',
    '.github/workflows/ci.yml',
  ];

  for (const file of files) {
    const exists = await fileExists(file);
    results.push({
      name: `Workflow: ${file}`,
      passed: exists,
      message: exists ? 'Found' : 'Missing',
      severity: exists ? 'info' : 'error',
    });
  }
}

async function checkScriptFiles(): Promise<void> {
  console.log('📋 Checking script files...');

  const files = [
    'scripts/ci/collect-metrics.ts',
    'scripts/ci/ai-logger.ts',
    'scripts/ci/compare-metrics.ts',
    'scripts/ci/visualize-metrics.ts',
    'scripts/ci/verify-setup.ts',
  ];

  for (const file of files) {
    const exists = await fileExists(file);
    results.push({
      name: `Script: ${file}`,
      passed: exists,
      message: exists ? 'Found' : 'Missing',
      severity: exists ? 'info' : 'error',
    });
  }
}

async function checkDocumentation(): Promise<void> {
  console.log('📋 Checking documentation...');

  const files = [
    'docs/CI_METRICS.md',
    'docs/CI_SETUP_GUIDE.md',
    'scripts/ci/README.md',
  ];

  for (const file of files) {
    const exists = await fileExists(file);
    results.push({
      name: `Documentation: ${file}`,
      passed: exists,
      message: exists ? 'Found' : 'Missing',
      severity: exists ? 'info' : 'warning',
    });
  }
}

async function checkPackageJson(): Promise<void> {
  console.log('📋 Checking package.json...');

  const packageJsonPath = 'package.json';
  const exists = await fileExists(packageJsonPath);

  if (!exists) {
    results.push({
      name: 'package.json',
      passed: false,
      message: 'Missing',
      severity: 'error',
    });
    return;
  }

  const content = await fs.readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(content);

  const requiredScripts = [
    'ci:metrics',
    'ci:compare',
    'ci:visualize',
    'ci:ai-log',
  ];

  for (const script of requiredScripts) {
    const exists = script in packageJson.scripts;
    results.push({
      name: `package.json script: ${script}`,
      passed: exists,
      message: exists ? 'Found' : 'Missing',
      severity: exists ? 'info' : 'warning',
    });
  }

  // Check dependencies
  const requiredDeps = ['tsx', '@playwright/test'];
  for (const dep of requiredDeps) {
    const exists = dep in packageJson.dependencies || dep in packageJson.devDependencies;
    results.push({
      name: `Dependency: ${dep}`,
      passed: exists,
      message: exists ? 'Found' : 'Missing',
      severity: exists ? 'info' : 'error',
    });
  }
}

async function checkCacheDirectories(): Promise<void> {
  console.log('📋 Checking .cache directories...');

  const dirs = [
    '.cache',
    '.cache/metrics',
    '.cache/logs',
    '.cache/ai_logs',
    '.cache/playwright',
  ];

  for (const dir of dirs) {
    const exists = await fileExists(dir);
    results.push({
      name: `Directory: ${dir}`,
      passed: exists,
      message: exists ? 'Exists' : 'Will be created automatically',
      severity: 'info',
    });
  }
}

async function checkGitignore(): Promise<void> {
  console.log('📋 Checking .gitignore...');

  const gitignorePath = '.gitignore';
  const exists = await fileExists(gitignorePath);

  if (!exists) {
    results.push({
      name: '.gitignore',
      passed: false,
      message: 'Missing',
      severity: 'warning',
    });
    return;
  }

  const content = await fs.readFile(gitignorePath, 'utf-8');

  const requiredEntries = [
    '.cache/',
    'test-results/',
    'playwright-report/',
  ];

  for (const entry of requiredEntries) {
    const exists = content.includes(entry);
    results.push({
      name: `.gitignore entry: ${entry}`,
      passed: exists,
      message: exists ? 'Found' : 'Missing',
      severity: exists ? 'info' : 'warning',
    });
  }
}

async function testScriptExecution(): Promise<void> {
  console.log('📋 Testing script execution...');

  try {
    // This is a smoke test - just check if the script can be imported
    const metricsScript = await import('./collect-metrics.js');
    results.push({
      name: 'Script execution test',
      passed: true,
      message: 'Scripts are executable',
      severity: 'info',
    });
  } catch (error: any) {
    results.push({
      name: 'Script execution test',
      passed: false,
      message: `Error: ${error.message}`,
      severity: 'warning',
    });
  }
}

function printResults(): void {
  console.log('\n' + '═'.repeat(80));
  console.log('📊 Verification Results');
  console.log('═'.repeat(80) + '\n');

  const errors = results.filter((r) => r.severity === 'error' && !r.passed);
  const warnings = results.filter((r) => r.severity === 'warning' && !r.passed);
  const passed = results.filter((r) => r.passed);

  // Print errors
  if (errors.length > 0) {
    console.log('❌ Errors:');
    for (const result of errors) {
      console.log(`  • ${result.name}: ${result.message}`);
    }
    console.log('');
  }

  // Print warnings
  if (warnings.length > 0) {
    console.log('⚠️  Warnings:');
    for (const result of warnings) {
      console.log(`  • ${result.name}: ${result.message}`);
    }
    console.log('');
  }

  // Print summary
  console.log('📈 Summary:');
  console.log(`  ✅ Passed: ${passed.length}`);
  console.log(`  ⚠️  Warnings: ${warnings.length}`);
  console.log(`  ❌ Errors: ${errors.length}`);
  console.log(`  📊 Total checks: ${results.length}`);
  console.log('');

  if (errors.length === 0 && warnings.length === 0) {
    console.log('🎉 All checks passed! Your CI metrics system is properly configured.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Create a test PR to verify the workflow runs');
    console.log('  2. Check the PR for the automated metrics comment');
    console.log('  3. Review the artifacts in the GitHub Actions run');
    console.log('');
  } else if (errors.length === 0) {
    console.log('✅ Setup is complete with minor warnings.');
    console.log('   The system should work, but you may want to address the warnings.');
    console.log('');
  } else {
    console.log('❌ Setup is incomplete. Please fix the errors above.');
    console.log('');
    console.log('Common fixes:');
    console.log('  • Missing files: Re-run the setup script');
    console.log('  • Missing dependencies: Run npm install');
    console.log('  • Missing scripts: Check package.json');
    console.log('');
  }

  console.log('═'.repeat(80));
}

async function main() {
  console.log('🔍 Verifying CI Metrics System Setup...\n');

  await checkWorkflowFiles();
  await checkScriptFiles();
  await checkDocumentation();
  await checkPackageJson();
  await checkCacheDirectories();
  await checkGitignore();
  await testScriptExecution();

  printResults();

  // Exit with error if there are critical errors
  const errors = results.filter((r) => r.severity === 'error' && !r.passed);
  if (errors.length > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { CheckResult, fileExists };
