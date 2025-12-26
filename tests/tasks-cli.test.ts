import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runTasks(repoRoot: string, cwd: string, args: string[]) {
  const cliPath = path.join(repoRoot, 'tools', 'tasks.js');
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

test('tasks CLI rewrites TASKS.md region (add/claim/done)', async () => {
  const repoRoot = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-tasks-'));
  const tasksPath = path.join(tmp, 'TASKS.md');

  fs.writeFileSync(
    tasksPath,
    [
      '# TASKS',
      '',
      '<!-- TASKS:BEGIN -->',
      '| id | status | prio | owner | title | note |',
      '|---:|:------:|:----:|:-----:|:------|:-----|',
      '| T001 | open | P1 | - | First | |',
      '<!-- TASKS:END -->',
      '',
    ].join('\n'),
    'utf8'
  );

  const add = runTasks(repoRoot, tmp, ['add', 'Second', '--prio', 'P0']);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  assert.ok(fs.readFileSync(tasksPath, 'utf8').includes('| T002 | open | P0 | - | Second |'), 'T002 should be added');

  const claim = runTasks(repoRoot, tmp, ['claim', 'T002', '--owner', 'Lead']);
  assert.equal(claim.status, 0, claim.stderr || claim.stdout);
  assert.ok(
    fs.readFileSync(tasksPath, 'utf8').includes('| T002 | claimed | P0 | Lead | Second |'),
    'T002 should be claimed'
  );

  const done = runTasks(repoRoot, tmp, ['done', 'T002', '--note', 'shipped']);
  assert.equal(done.status, 0, done.stderr || done.stdout);
  assert.ok(
    fs.readFileSync(tasksPath, 'utf8').includes('| T002 | done | P0 | Lead | Second | shipped |'),
    'T002 should be done with note'
  );

  const list = runTasks(repoRoot, tmp, ['list']);
  assert.equal(list.status, 0, list.stderr || list.stdout);
  assert.ok(list.stdout.includes('T001'), 'list should include T001');
  assert.ok(!list.stdout.includes('T002'), 'list should hide done tasks by default');

  const listAll = runTasks(repoRoot, tmp, ['list', '--all']);
  assert.equal(listAll.status, 0, listAll.stderr || listAll.stdout);
  assert.ok(listAll.stdout.includes('T002'), 'list --all should include done tasks');
});

