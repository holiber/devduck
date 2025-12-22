#!/usr/bin/env node
/**
 * Background task queue worker.
 *
 * Maintains a simple FIFO queue under: .cache/tasks/.queue/queue.json
 * and processes tasks one by one.
 *
 * Supported task types:
 * - tracker: runs docker-based plan generation via scripts/docker.js <KEY> --parallel --json
 * - info: cannot be auto-executed; marks as needs_manual with a log note
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const QUEUE_MODE = (process.env.QUEUE_MODE || 'run').toLowerCase();
const CI_RECHECK_MS = Number.parseInt(process.env.CI_RECHECK_MS || '30000', 10);

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getTasksRoot() {
  return path.join(getProjectRoot(), '.cache', 'tasks');
}

function getQueueDir() {
  return path.join(getTasksRoot(), '.queue');
}

function getQueueFile() {
  return path.join(getQueueDir(), 'queue.json');
}

function getLockFile() {
  return path.join(getQueueDir(), 'worker.lock');
}

function getStateFile() {
  return path.join(getQueueDir(), 'state.json');
}

function ensureQueueFiles() {
  fs.mkdirSync(getQueueDir(), { recursive: true });
  if (!fs.existsSync(getQueueFile())) {
    fs.writeFileSync(getQueueFile(), JSON.stringify({ items: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(getStateFile())) {
    fs.writeFileSync(getStateFile(), JSON.stringify({ runningTaskId: null }, null, 2), 'utf8');
  }
}

function readJsonSafe(p, fallback = null) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p, data) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function acquireLock() {
  ensureQueueFiles();
  try {
    const fd = fs.openSync(getLockFile(), 'wx');
    fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
    return fd;
  } catch {
    return null;
  }
}

function releaseLock(fd) {
  try {
    if (fd) fs.closeSync(fd);
  } catch {}
  try {
    fs.unlinkSync(getLockFile());
  } catch {}
}

function readTaskState(taskId) {
  const p = path.join(getTasksRoot(), taskId, 'task.json');
  return readJsonSafe(p, null);
}

function writeTaskState(taskId, state) {
  const p = path.join(getTasksRoot(), taskId, 'task.json');
  writeJsonAtomic(p, state);
}

function appendRun(taskId, patch) {
  const state = readTaskState(taskId);
  if (!state) return;
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  state.runs.push({ ts: new Date().toISOString(), ...patch });
  writeTaskState(taskId, state);
}

function setStatus(taskId, status, meta = {}) {
  const state = readTaskState(taskId);
  if (!state) return;
  state.status = status;
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  state.runs.push({ ts: new Date().toISOString(), event: 'status', status, ...meta });
  writeTaskState(taskId, state);
}

function writeTaskLog(taskId, { ok, title, stdout, stderr }) {
  const dir = path.join(getTasksRoot(), taskId, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const p = path.join(dir, `${ts}.queue.${ok ? 'ok' : 'fail'}.log`);
  const header = [`title: ${title || 'task'}`, `ok: ${ok}`, `time: ${new Date().toISOString()}`, ''].join('\n');
  fs.writeFileSync(p, header + (stdout || '') + (stderr ? `\n\n[stderr]\n${stderr}` : ''), 'utf8');
  return p;
}

function takeNextQueueItem() {
  ensureQueueFiles();
  const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
  const items = Array.isArray(q.items) ? q.items : [];
  if (!items.length) return null;

  const now = Date.now();
  const matchesMode = (item) => {
    const type = (item && item.type) || 'run';
    const nextCheckAt = item && item.nextCheckAt ? Date.parse(item.nextCheckAt) : null;
    if (type === 'ci-wait' && nextCheckAt && Number.isFinite(nextCheckAt) && nextCheckAt > now) {
      return false;
    }
    if (QUEUE_MODE === 'ci') return type === 'ci-wait';
    if (QUEUE_MODE === 'run') return type !== 'ci-wait';
    return true;
  };

  const idx = items.findIndex(matchesMode);
  if (idx === -1) {
    return null;
  }

  const [next] = items.splice(idx, 1);
  writeJsonAtomic(getQueueFile(), { items });
  return next;
}

function setRunningState(taskId) {
  writeJsonAtomic(getStateFile(), { runningTaskId: taskId, since: new Date().toISOString() });
}

function clearRunningState() {
  writeJsonAtomic(getStateFile(), { runningTaskId: null, since: null });
}

function enqueueQueueItem(item) {
  ensureQueueFiles();
  const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
  q.items = Array.isArray(q.items) ? q.items : [];
  q.items.push(item);
  writeJsonAtomic(getQueueFile(), q);
}

function makePrUrl(prId) {
  if (!prId) return null;
  return `https://a.yandex-team.ru/review/${prId}`;
}

function runTrackerTask(taskId, state) {
  const key = state?.ticket?.key || state?.id || null;
  if (!key) {
    return { ok: false, stdout: '', stderr: 'Missing ticket.key in task.json' };
  }

  const res = spawnSync(process.execPath, [path.join(getProjectRoot(), 'scripts', 'docker.js'), key, '--parallel', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  return {
    ok: res.status === 0,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
  };
}

function processCiWait(item, state) {
  const taskId = item?.taskId || null;
  if (!taskId) return;
  const prId = item?.prId || state?.pr?.id || null;
  const prUrl = item?.prUrl || state?.pr?.url || makePrUrl(prId);

  setRunningState(taskId);

  if (!prId) {
    const logPath = writeTaskLog(taskId, { ok: false, title: 'ci-missing', stdout: 'PR id is missing for CI wait item', stderr: '' });
    appendRun(taskId, { event: 'ci_missing', ok: false, logPath });
    setStatus(taskId, 'needs_manual', { by: 'ci', reason: 'pr_missing', logPath });
    clearRunningState();
    return;
  }

  const res = spawnSync(process.execPath, [path.join(getProjectRoot(), 'scripts', 'ci.js'), String(prId), '--format', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let parsed = null;
  try {
    parsed = res.status === 0 && res.stdout ? JSON.parse(res.stdout) : null;
  } catch {
    parsed = null;
  }

  const checks = parsed && parsed.checks ? parsed.checks : null;
  const failed = checks && (Number.isFinite(checks.failed) ? checks.failed : (Number.isFinite(checks.failedCount) ? checks.failedCount : 0));
  const passed = checks && (Number.isFinite(checks.passed) ? checks.passed : (Number.isFinite(checks.passedCount) ? checks.passedCount : 0));
  const total = checks && (Number.isFinite(checks.total) ? checks.total : 0);

  let ciStatus = 'running';
  if (failed > 0) ciStatus = 'failed';
  else if (total > 0 && passed >= total) ciStatus = 'passed';
  else if (parsed && parsed.canMerge === true) ciStatus = 'passed';

  const nowIso = new Date().toISOString();
  const prPatch = {
    ...(state.pr || {}),
    id: prId,
    url: prUrl,
    ciStatus,
    checks,
    lastCiCheck: nowIso,
  };

  writeTaskState(taskId, { ...state, pr: prPatch });

  if (ciStatus === 'running' || res.status !== 0) {
    appendRun(taskId, { event: 'ci_wait', status: 'ci_wait', prId, prUrl });
    setStatus(taskId, 'ci_wait', { by: 'ci', prId, prUrl });
    enqueueQueueItem({
      ...item,
      prId,
      prUrl,
      type: 'ci-wait',
      nextCheckAt: new Date(Date.now() + CI_RECHECK_MS).toISOString(),
    });
    clearRunningState();
    return;
  }

  const ok = ciStatus === 'passed';
  const summary = `CI for PR #${prId}: ${ciStatus}. passed=${passed ?? 0}/${total ?? 0} failed=${failed ?? 0}`;
  const logPath = writeTaskLog(taskId, { ok, title: 'ci-status', stdout: summary, stderr: res.stderr || '' });
  appendRun(taskId, { event: 'ci_done', ok, prId, prUrl, ciStatus, logPath });
  setStatus(taskId, 'queued', { by: 'ci', prId, prUrl, ciStatus, logPath });

  enqueueQueueItem({ taskId, type: 'ci-complete', prId, prUrl, ciStatus, enqueuedAt: nowIso });
  clearRunningState();
}

function processCiComplete(item, state) {
  const taskId = item?.taskId || null;
  if (!taskId) return;
  const ciStatus = item?.ciStatus || state?.pr?.ciStatus || 'unknown';
  const prId = item?.prId || state?.pr?.id || null;
  const prUrl = item?.prUrl || state?.pr?.url || makePrUrl(prId);

  setRunningState(taskId);

  const ok = ciStatus === 'passed';
  const summary = `CI ${ciStatus} for PR ${prId || '?'} (${prUrl || 'n/a'})`;
  const logPath = writeTaskLog(taskId, { ok, title: 'ci-result', stdout: summary, stderr: '' });
  appendRun(taskId, { event: 'ci_result', ok, prId, prUrl, ciStatus, logPath });
  setStatus(taskId, ok ? 'done' : 'needs_manual', { by: 'ci', prId, prUrl, ciStatus, logPath });

  clearRunningState();
}

function processRunItem(item, state) {
  const taskId = item?.taskId || null;
  if (!taskId) return;

  setRunningState(taskId);
  setStatus(taskId, 'executing', { by: 'queue' });
  appendRun(taskId, { event: 'queue_start' });

  if (state.type === 'tracker') {
    const r = runTrackerTask(taskId, state);
    const logPath = writeTaskLog(taskId, { ok: r.ok, title: `tracker:${state.ticket?.key || state.id}`, stdout: r.stdout, stderr: r.stderr });
    appendRun(taskId, { event: 'queue_done', ok: r.ok, logPath });
    setStatus(taskId, r.ok ? 'done' : 'failed', { by: 'queue', logPath });
    clearRunningState();
    return;
  }

  // info/free-text tasks: no automatic executor yet
  const note = [
    'This is a free-text task. Automatic execution is not implemented yet.',
    'Open plan.md and follow the plan manually, or implement an executor for this task type.',
    '',
  ].join('\n');
  const logPath = writeTaskLog(taskId, { ok: true, title: 'info:needs_manual', stdout: note, stderr: '' });
  appendRun(taskId, { event: 'queue_done', ok: true, logPath, note: 'needs_manual' });
  setStatus(taskId, 'needs_manual', { by: 'queue', logPath });
  clearRunningState();
}

function processItem(item) {
  const taskId = item?.taskId || null;
  if (!taskId) return;
  const state = readTaskState(taskId);
  if (!state) return;

  const type = (item && item.type) || 'run';
  if (type === 'ci-wait') return processCiWait(item, state);
  if (type === 'ci-complete') return processCiComplete(item, state);
  return processRunItem(item, state);
}

function main() {
  const pollMs = 1500;
  const lockFd = acquireLock();
  if (!lockFd) {
    // Another worker is running
    process.exit(0);
  }

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const item = takeNextQueueItem();
      if (!item) {
        sleepMs(pollMs);
        continue;
      }
      try {
        processItem(item);
      } catch {
        clearRunningState();
      }
    }
  } finally {
    releaseLock(lockFd);
  }
}

if (require.main === module) {
  main();
}

