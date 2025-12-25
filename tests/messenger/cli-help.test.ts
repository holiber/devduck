import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runHelp(args: string[]) {
  return spawnSync('npx', ['tsx', 'modules/messenger/scripts/messenger.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 120_000
  });
}

test('messenger CLI exposes required inputs as options', () => {
  const helpHistory = runHelp(['getChatHistory', '--help']);
  assert.equal(helpHistory.status, 0, helpHistory.stderr);
  assert.match(helpHistory.stdout, /--chatId\s+chatId \(string\)/);

  const helpFile = runHelp(['downloadFile', '--help']);
  assert.equal(helpFile.status, 0, helpFile.stderr);
  assert.match(helpFile.stdout, /--fileId\s+fileId \(string\)/);
});

