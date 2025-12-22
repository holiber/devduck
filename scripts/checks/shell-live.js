#!/usr/bin/env node

/**
 * Shell Live Check (Staging)
 * 
 * This script verifies that the shell staging environment is working correctly.
 * 
 * Steps:
 * 1. Launch browser with Playwright
 * 2. Set auth cookie (devcrm)
 * 3. Navigate to settings page on staging
 * 4. Check for expected element
 * 5. Exit with appropriate code
 */

const path = require('path');
const fs = require('fs');

// Load .env file from devduck project
function loadEnv() {
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}

loadEnv();

// Configuration
const CONFIG = {
  // Staging URL to check (using deployed test environment)
  checkUrl: 'https://comdep.release.crm-test.yandex-team.ru/settings',
  
  // Cookie domain for test environment
  cookieDomain: '.crm-test.yandex-team.ru',
  
  // Element selector to verify
  elementSelector: '[data-unstable-testid="Settings"]',
  
  // Timeouts (in milliseconds)
  pageLoadTimeout: 30000,      // 30 seconds for page to load
  elementWaitTimeout: 30000,   // 30 seconds for element to appear
};

// Log with timestamp
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Check page with Playwright
async function checkPageWithPlaywright(url, selector) {
  log('Launching Playwright browser...');
  
  // Dynamic import for Playwright (may not be installed)
  let playwright;
  try {
    playwright = require('playwright');
  } catch (err) {
    log('Playwright not installed. Attempting to use npx...');
    throw new Error('Playwright not installed. Run: npm install playwright');
  }
  
  const browser = await playwright.chromium.launch({
    headless: true
  });
  
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true  // Accept self-signed certs
    });
    
    // Set auth cookie if TEST_LOGIN is provided
    const testLogin = process.env.TEST_LOGIN;
    if (testLogin) {
      log(`Setting devcrm cookie for user: ${testLogin} on domain: ${CONFIG.cookieDomain}`);
      await context.addCookies([{
        name: 'devcrm',
        value: testLogin,
        domain: CONFIG.cookieDomain,
        path: '/'
      }]);
    } else {
      log('Warning: TEST_LOGIN not set, page may require authentication');
    }
    
    const page = await context.newPage();
    
    log(`Navigating to ${url}...`);
    await page.goto(url, { 
      timeout: CONFIG.pageLoadTimeout,
      waitUntil: 'networkidle'
    });
    
    log(`Current URL: ${page.url()}`);
    log(`Waiting for element: ${selector}...`);
    
    try {
      const element = await page.waitForSelector(selector, {
        timeout: CONFIG.elementWaitTimeout,
        state: 'visible'
      });
      
      if (element) {
        log('Element found! Page rendered correctly.');
        return true;
      } else {
        log('Element not found.');
        return false;
      }
    } catch (err) {
      // Take screenshot on failure for debugging
      const screenshotPath = path.join(__dirname, '../../.cache/shell-live-error.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`Screenshot saved to: ${screenshotPath}`);
      log(`Page title: ${await page.title()}`);
      log(`Final URL: ${page.url()}`);
      throw err;
    }
  } finally {
    await browser.close();
    log('Browser closed');
  }
}

// Main function
async function main() {
  log('=== Shell Live Check (Staging) ===');
  log(`Testing URL: ${CONFIG.checkUrl}`);
  
  let exitCode = 1;
  
  try {
    // Check page with Playwright
    const pageOk = await checkPageWithPlaywright(CONFIG.checkUrl, CONFIG.elementSelector);
    
    if (pageOk) {
      log('SUCCESS: Shell staging environment is working correctly');
      exitCode = 0;
    } else {
      log('FAILURE: Page did not render expected element');
      exitCode = 1;
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
    exitCode = 1;
  }
  
  log(`=== Check completed with exit code ${exitCode} ===`);
  process.exit(exitCode);
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
