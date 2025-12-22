/**
 * Prompt queue persistence for DevDuck.
 *
 * Stores prompt items under:
 *   .cache/tasks/.prompts/queue.json
 *   .cache/tasks/.prompts/state.json
 *   .cache/tasks/.prompts/bg.pid
 *
 * Designed for simple host-side concurrency:
 * - atomic writes (write tmp + rename)
 * - lock file (open with 'wx')
 */

const fs = require('fs');
const path = require('path');

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getTasksRoot() {
  return path.join(getProjectRoot(), '.cache', 'tasks');
}

function getPromptsDir() {
  return path.join(getTasksRoot(), '.prompts');
}

function getQueueFile() {
  return path.join(getPromptsDir(), 'queue.json');
}

function getStateFile() {
  return path.join(getPromptsDir(), 'state.json');
}

function getLockFile() {
  return path.join(getPromptsDir(), 'worker.lock');
}

function getPidFile() {
  return path.join(getPromptsDir(), 'bg.pid');
}

function ensureFiles() {
  fs.mkdirSync(getPromptsDir(), { recursive: true });
  if (!fs.existsSync(getQueueFile())) {
    fs.writeFileSync(getQueueFile(), JSON.stringify({ items: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(getStateFile())) {
    fs.writeFileSync(getStateFile(), JSON.stringify({ runningPromptId: null, since: null }, null, 2), 'utf8');
  }
}

function readJsonSafe(p, fallback) {
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

function makeId() {
  // UUID-ish without extra deps.
  return `P-${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${process.pid}`;
}

function nowIso() {
  return new Date().toISOString();
}

function acquireLock() {
  ensureFiles();
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

function readQueue() {
  ensureFiles();
  const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
  q.items = Array.isArray(q.items) ? q.items : [];
  return q;
}

function writeQueue(queue) {
  writeJsonAtomic(getQueueFile(), queue);
}

function pruneHistory(maxItems) {
  const limitRaw = Number(maxItems);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;
  const q = readQueue();
  if (!Array.isArray(q.items)) q.items = [];
  if (q.items.length <= limit) return { ok: true, pruned: 0, total: q.items.length };
  const before = q.items.length;
  q.items = q.items.slice(-limit);
  writeQueue(q);
  return { ok: true, pruned: before - q.items.length, total: q.items.length };
}

function readState() {
  ensureFiles();
  return readJsonSafe(getStateFile(), { runningPromptId: null, since: null }) || { runningPromptId: null, since: null };
}

function setRunningState(runningPromptId) {
  writeJsonAtomic(getStateFile(), { runningPromptId: runningPromptId || null, since: runningPromptId ? nowIso() : null });
}

function clearRunningState() {
  setRunningState(null);
}

function enqueuePrompt(promptText, meta = {}) {
  const q = readQueue();
  const item = {
    id: makeId(),
    prompt: String(promptText || '').trim(),
    status: 'queued',
    createdAt: nowIso(),
    claimedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    meta: meta && typeof meta === 'object' ? meta : {},
  };
  q.items.push(item);
  writeQueue(q);
  return item;
}

function listPrompts({ limit = 50 } = {}) {
  const q = readQueue();
  const items = q.items.slice(-Math.max(1, Number(limit) || 50));
  return { items };
}

function claimNextPrompt() {
  const q = readQueue();
  const idx = q.items.findIndex((it) => it && it.status === 'queued');
  if (idx === -1) return null;
  const it = q.items[idx];
  it.status = 'processing';
  it.claimedAt = nowIso();
  it.error = null;
  q.items[idx] = it;
  writeQueue(q);
  setRunningState(it.id);
  return it;
}

function completePrompt(promptId, patch) {
  const q = readQueue();
  const idx = q.items.findIndex((it) => it && it.id === promptId);
  if (idx === -1) return { ok: false, reason: 'not_found' };
  const it = q.items[idx];
  const next = {
    ...it,
    ...((patch && typeof patch === 'object') ? patch : {}),
    finishedAt: nowIso(),
  };
  q.items[idx] = next;
  writeQueue(q);
  if (readState().runningPromptId === promptId) clearRunningState();
  return { ok: true, item: next };
}

function failPrompt(promptId, errorMessage, patch = {}) {
  return completePrompt(promptId, {
    status: 'failed',
    error: String(errorMessage || 'Unknown error'),
    ...(patch && typeof patch === 'object' ? patch : {}),
  });
}

function markDone(promptId, result, patch = {}) {
  return completePrompt(promptId, {
    status: 'done',
    result: result ?? null,
    ...(patch && typeof patch === 'object' ? patch : {}),
  });
}

module.exports = {
  // paths
  getPromptsDir,
  getQueueFile,
  getStateFile,
  getPidFile,
  getLockFile,
  // io
  ensureFiles,
  acquireLock,
  releaseLock,
  readQueue,
  writeQueue,
  readState,
  enqueuePrompt,
  listPrompts,
  claimNextPrompt,
  markDone,
  failPrompt,
  clearRunningState,
  setRunningState,
  pruneHistory,
};


