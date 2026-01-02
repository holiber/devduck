import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function runHelp(args: string[]) {
  return spawnSync('npx', ['tsx', 'extensions/messenger/scripts/messenger.ts', ...args], {
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

test('ci CLI positional still works (no duplicate required flags)', () => {
  const ciScript = 'extensions/ci/scripts/ci.ts';
  if (!fs.existsSync(ciScript)) {
    // In minimal builds where CI module is not present, skip the regression test.
    return;
  }
  const ciHelp = spawnSync('npx', ['tsx', 'extensions/ci/scripts/ci.ts', 'fetchPR', '--help'], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 120_000
  });
  assert.equal(ciHelp.status, 0, ciHelp.stderr);
  // Positional command signature should remain.
  assert.match(ciHelp.stdout, /fetchPR <prIdOrBranch>/);
  // Ensure we did not also expose both positional fields as separate flags.
  assert.doesNotMatch(ciHelp.stdout, /--prId\s+/);
  assert.doesNotMatch(ciHelp.stdout, /--branch\s+/);
});

