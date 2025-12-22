#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Get project root directory
 */
function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

/**
 * Read .env file and return object with key-value pairs
 */
function readEnvFile(envPath) {
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        env[key] = value.slice(1, -1);
      } else {
        env[key] = value;
      }
    }
    return env;
  } catch {
    return {};
  }
}

/**
 * Get AR_TOKEN from environment or .env file
 */
function getArToken() {
  if (process.env.AR_TOKEN && String(process.env.AR_TOKEN).trim()) {
    return String(process.env.AR_TOKEN).trim();
  }
  const envPath = path.join(getProjectRoot(), '.env');
  const env = readEnvFile(envPath);
  if (env.AR_TOKEN && String(env.AR_TOKEN).trim()) {
    return String(env.AR_TOKEN).trim();
  }
  return '';
}

/**
 * Get PR information from Arcanum API including merge checks
 * @param {number|string} prId - PR ID
 * @param {string} token - OAuth token
 * @returns {Promise<object>} PR information with checks
 */
function getPRInfo({ prId, token }) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: 'arcanum.yandex.net',
        path: `/api/v1/review-requests/${prId}?fields=id,status,checks,summary,from_branch,to_branch`,
        headers: {
          Authorization: `OAuth ${token}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({
              ok: res.statusCode === 200,
              statusCode: res.statusCode,
              data: json.data || null,
              error: json.errors ? JSON.stringify(json.errors) : null,
            });
          } catch (e) {
            resolve({
              ok: false,
              statusCode: res.statusCode,
              data: null,
              error: `Failed to parse response: ${e.message}`,
              rawBody: data,
            });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        ok: false,
        statusCode: null,
        data: null,
        error: err.message,
      });
    });

    req.end();
  });
}

/**
 * Format checks for output
 */
function formatChecks(checks) {
  if (!checks || !Array.isArray(checks)) {
    return { required: [], optional: [], passed: [], failed: [] };
  }

  const required = checks.filter((c) => c.required === true);
  const optional = checks.filter((c) => c.required === false);
  const passed = checks.filter((c) => c.satisfied === true);
  const failed = checks.filter((c) => c.satisfied === false);

  return {
    required,
    optional,
    passed,
    failed,
    total: checks.length,
    requiredCount: required.length,
    optionalCount: optional.length,
    passedCount: passed.length,
    failedCount: failed.length,
  };
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return { prId: null, format: 'json' };
  }

  const prId = args[0];
  const format = args.includes('--format') 
    ? args[args.indexOf('--format') + 1] || 'json'
    : 'json';

  return { prId, format };
}

/**
 * Main function
 */
async function main() {
  const { prId, format } = parseArgs();

  if (!prId) {
    console.error('Usage: node scripts/ci.js <PR_ID> [--format json|summary]');
    console.error('Example: node scripts/ci.js 11150252');
    console.error('Example: node scripts/ci.js 11150252 --format summary');
    process.exit(1);
  }

  const token = getArToken();
  if (!token) {
    console.error('AR_TOKEN is missing (set it in .env or export it in the environment).');
    process.exit(1);
  }

  const result = await getPRInfo({ prId, token });

  if (!result.ok) {
    console.error(`Failed to get PR info (status: ${result.statusCode ?? 'n/a'})`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
    }
    if (result.rawBody) {
      console.error(`Response: ${result.rawBody.slice(0, 500)}`);
    }
    process.exit(1);
  }

  const prData = result.data;
  const checks = formatChecks(prData.checks);

  if (format === 'summary') {
    // Human-readable summary
    console.log(`PR #${prData.id}: ${prData.summary || 'N/A'}`);
    console.log(`Status: ${prData.status || 'N/A'}`);
    console.log(`Branch: ${prData.from_branch || 'N/A'} → ${prData.to_branch || 'N/A'}`);
    console.log('');
    console.log(`Checks: ${checks.total} total (${checks.requiredCount} required, ${checks.optionalCount} optional)`);
    console.log(`Passed: ${checks.passedCount} | Failed: ${checks.failedCount}`);
    console.log('');

    if (checks.failed.length > 0) {
      console.log('❌ Failed checks:');
      checks.failed.forEach((check) => {
        const required = check.required ? '(required)' : '(optional)';
        console.log(`  - ${check.type} ${required}`);
      });
      console.log('');
    }

    if (checks.passed.length > 0 && checks.failed.length === 0) {
      console.log('✅ All checks passed!');
    } else if (checks.failed.length > 0) {
      const requiredFailed = checks.failed.filter((c) => c.required);
      if (requiredFailed.length > 0) {
        console.log(`⚠️  ${requiredFailed.length} required check(s) failed. PR cannot be merged.`);
      }
    }
  } else {
    // JSON output
    const output = {
      pr: {
        id: prData.id,
        summary: prData.summary,
        status: prData.status,
        from_branch: prData.from_branch,
        to_branch: prData.to_branch,
      },
      checks: {
        total: checks.total,
        required: checks.requiredCount,
        optional: checks.optionalCount,
        passed: checks.passedCount,
        failed: checks.failedCount,
        all: prData.checks || [],
        passedChecks: checks.passed,
        failedChecks: checks.failed,
      },
      canMerge: checks.failed.filter((c) => c.required).length === 0,
    };

    console.log(JSON.stringify(output, null, 2));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
  });
}

module.exports = { getPRInfo, formatChecks, getArToken };

