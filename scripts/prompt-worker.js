#!/usr/bin/env node
/**
 * Background prompt processor.
 *
 * - Claims prompts from `.cache/tasks/.prompts/queue.json`
 * - Routes them to actionable intents (`scripts/prompt-router.js`)
 * - Ensures warm Docker workers exist
 * - Dispatches plan generation via existing `scripts/task.js run ... --mode plan`
 *
 * Important constraints:
 * - Host-side worker (uses docker CLI and Node spawn).
 * - Must be safe to run in the background and be restartable.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const promptStore = require('./prompt-store');
const { routePrompt } = require('./prompt-router');

const POLL_MS = Number.parseInt(process.env.PROMPT_POLL_MS || '1500', 10);
const MAX_PROMPTS_HISTORY = Number.parseInt(process.env.PROMPT_MAX_HISTORY || '200', 10);
const DOCKER_EXEC_TIMEOUT_MS = Number.parseInt(process.env.PROMPT_DOCKER_EXEC_TIMEOUT_MS || '45000', 10);
const DISPATCH_TIMEOUT_MS = Number.parseInt(process.env.PROMPT_DISPATCH_TIMEOUT_MS || String(30 * 60 * 1000), 10);
const ENSURE_WORKERS_TIMEOUT_MS = Number.parseInt(process.env.PROMPT_ENSURE_WORKERS_TIMEOUT_MS || String(15 * 60 * 1000), 10);

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function logLine(message) {
  try {
    const dir = promptStore.getPromptsDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'bg.log');
    const line = `[${new Date().toISOString()}] ${String(message || '')}\n`;
    fs.appendFileSync(p, line, 'utf8');
  } catch {
    // best-effort
  }
}

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function runNodeScript(scriptRel, args, options = {}) {
  const res = spawnSync(process.execPath, [path.join(getProjectRoot(), scriptRel), ...(args || [])], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeoutMs || 0,
  });
  return {
    ok: res.status === 0,
    status: res.status || 0,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

function dockerWorkersPresent() {
  const r = spawnSync('docker', ['ps', '-a', '--filter', 'name=devduck-worker-', '--format', '{{.Names}}'], { encoding: 'utf8', stdio: 'pipe' });
  if (r.status !== 0) return false;
  return (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean).length > 0;
}

function ensureWorkers() {
  if (dockerWorkersPresent()) return { ok: true, changed: false };
  // Create warm workers + service container.
  // This reuses existing logic in scripts/docker.js.
  logLine('No warm workers detected; running scripts/docker.js recreate...');
  const r = runNodeScript('scripts/docker.js', ['recreate'], { timeoutMs: ENSURE_WORKERS_TIMEOUT_MS });
  return { ok: r.ok, changed: true, details: r };
}

function trimPromptQueueHistory() {
  promptStore.pruneHistory(MAX_PROMPTS_HISTORY);
}

function fetchOpenAssignedCrmIssues() {
  // Use Tracker API via scripts/tracker.js helper.
  // We intentionally avoid adding heavy filtering features here;
  // keep it deterministic and rely on server filter + client-side open-only filter.
  const tracker = require('./tracker');
  const raw = tracker.request('POST', '/v3/issues/_search', JSON.stringify({ filter: { queue: ['CRM'], assignee: tracker.getMyLogin() } }));
  const issues = JSON.parse(raw);
  const open = issues.filter((it) => {
    const statusKey = it.statusType?.key || it.status?.key || '';
    return statusKey !== 'done' && statusKey !== 'closed';
  });
  return open.map((it) => ({ key: it.key, summary: it.summary || '' }));
}

function guessBranchNameForIssue(issueKey, issueSummary) {
  // Match the branch naming used in warm-worker mode in scripts/docker.js:
  //   `${issueKey}_DD_${slug}`
  // We do not want an AI call here; use deterministic transliteration+slug.
  const raw = String(issueSummary || 'task');
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
    о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
    ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const translit = (s) =>
    String(s || '')
      .split('')
      .map((ch) => map[ch.toLowerCase()] ?? ch)
      .join('');
  const slugify = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+/, '')
      .replace(/_+$/, '')
      .replace(/_+/g, '_')
      .slice(0, 40) || 'task';

  const slug = slugify(raw) !== 'task' ? slugify(raw) : slugify(translit(raw));
  return `${issueKey}_DD_${slug}`;
}

function checkPrExistsForBranch({ workerName = 'devduck-worker-1', branchName }) {
  // We run arc commands inside warm worker container to avoid host arc state coupling.
  // arc pr status returns JSON if PR exists; otherwise exits non-zero.
  const cmd = [
    'docker',
    'exec',
    workerName,
    'bash',
    '-lc',
    [
      'set -euo pipefail',
      'cd "$HOME/arcadia"',
      'export PATH="$HOME/arcadia:$PATH"',
      `arc checkout "${branchName}" 2>/dev/null || arc checkout -b "${branchName}" 2>/dev/null || true`,
      // `arc pr status --json` is our source of truth.
      'arc pr status --json',
    ].join('\n'),
  ];

  const res = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', stdio: 'pipe' });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { exists: true, timeout: true, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
  }
  if (res.status === 0) {
    // Exists (JSON likely in stdout).
    return { exists: true, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
  }
  return { exists: false, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

function dispatchPlanGeneration(issueKeys) {
  if (!issueKeys.length) {
    return { ok: true, skipped: true, reason: 'no_issue_keys' };
  }
  // Delegate to existing docker runner via task.js (it runs docker.js under the hood).
  logLine(`Dispatching plan generation for ${issueKeys.length} issue(s): ${issueKeys.join(',')}`);
  const r = runNodeScript(
    'scripts/task.js',
    ['run', issueKeys.join(','), '--mode', 'plan', '--parallel', '--json'],
    { timeoutMs: DISPATCH_TIMEOUT_MS },
  );
  return { ok: r.ok, details: r };
}

function handlePrompt(promptItem) {
  const intent = routePrompt(promptItem.prompt);
  logLine(`Claimed prompt ${promptItem.id}: intent=${intent.type}`);

  const ensured = ensureWorkers();
  if (!ensured.ok) {
    return { ok: false, error: `Failed to ensure docker workers: ${ensured.details?.stderr || ensured.details?.stdout || 'unknown error'}` };
  }

  if (intent.type === 'explicit_issue_keys') {
    const issueKeys = Array.isArray(intent.issueKeys) ? intent.issueKeys : [];
    const dispatched = dispatchPlanGeneration(issueKeys);
    if (!dispatched.ok) return { ok: false, error: dispatched.details?.stderr || dispatched.details?.stdout || 'plan dispatch failed' };
    return { ok: true, result: { intent, issueKeys, dispatched: true } };
  }

  if (intent.type === 'crm_no_pr') {
    const issues = fetchOpenAssignedCrmIssues();
    const withoutPr = [];
    const checked = [];

    for (const it of issues) {
      const issueKey = it.key;
      const branchName = guessBranchNameForIssue(issueKey, it.summary);
      const pr = spawnSync(
        'docker',
        [
          'exec',
          'devduck-worker-1',
          'bash',
          '-lc',
          [
            'set -euo pipefail',
            'cd "$HOME/arcadia"',
            'export PATH="$HOME/arcadia:$PATH"',
            `arc checkout "${branchName}" 2>/dev/null || arc checkout -b "${branchName}" 2>/dev/null || true`,
            'arc pr status --json',
          ].join('\n'),
        ],
        { encoding: 'utf8', stdio: 'pipe', timeout: DOCKER_EXEC_TIMEOUT_MS },
      );
      const timedOut = pr.error && pr.error.code === 'ETIMEDOUT';
      const prExists = pr.status === 0 || timedOut;
      checked.push({ issueKey, branchName, prExists, timeout: !!timedOut });
      // Conservative: if we cannot check (timeout), assume PR exists to avoid duplicates.
      if (!prExists) withoutPr.push(issueKey);
    }

    const dispatched = dispatchPlanGeneration(withoutPr);
    if (!dispatched.ok) {
      return {
        ok: false,
        error: dispatched.details?.stderr || dispatched.details?.stdout || 'plan dispatch failed',
        result: { intent, checked, selected: withoutPr },
      };
    }
    return { ok: true, result: { intent, checked, selected: withoutPr, dispatched: true } };
  }

  return { ok: false, error: 'Unknown prompt. Provide issue keys or ask for CRM tasks without PRs.' };
}

function main() {
  const lockFd = promptStore.acquireLock();
  if (!lockFd) process.exit(0); // another worker is running

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      trimPromptQueueHistory();
      const next = promptStore.claimNextPrompt();
      if (!next) {
        sleepMs(POLL_MS);
        continue;
      }

      try {
        const res = handlePrompt(next);
        if (res.ok) {
          promptStore.markDone(next.id, res.result);
          logLine(`Prompt ${next.id} done`);
        } else {
          promptStore.failPrompt(next.id, res.error, res.result ? { result: res.result } : {});
          logLine(`Prompt ${next.id} failed: ${res.error}`);
        }
      } catch (e) {
        promptStore.failPrompt(next.id, e && e.message ? e.message : 'Unhandled error');
        logLine(`Prompt ${next.id} crashed: ${e && e.message ? e.message : 'Unhandled error'}`);
      }
    }
  } finally {
    promptStore.releaseLock(lockFd);
  }
}

if (require.main === module) {
  main();
}


