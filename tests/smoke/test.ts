import fs from 'fs';
import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

function appendBrowserLog(line: string): void {
  const logPath = process.env.BROWSER_CONSOLE_LOG_PATH || '';
  if (!logPath) return;
  fs.appendFileSync(logPath, line + '\n', 'utf8');
}

function attachConsoleLogging(page: Page): void {
  page.on('console', msg => {
    appendBrowserLog(`[console.${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    appendBrowserLog(`[pageerror] ${err.message}`);
  });
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    attachConsoleLogging(page);
    await use(page);
  }
});

export { expect };

