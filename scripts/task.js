#!/usr/bin/env node
/**
 * Task orchestrator (WIP)
 *
 * - Stores task state under .cache/tasks/
 * - Can run Tracker-backed tasks (by key or URL) via docker worker pool (scripts/docker.js)
 * - Can create local “text tasks” (free-form input) as placeholders
 *
 * Tracker is read-only (no writes).
 */

const path = require('path');
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');
const tracker = require('./tracker');
const promptStore = require('./prompt-store');

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getTasksRoot() {
  return path.join(getProjectRoot(), '.cache', 'tasks');
}

function ensureTasksRoot() {
  fs.mkdirSync(getTasksRoot(), { recursive: true });
}

function getQueueDir() {
  return path.join(getTasksRoot(), '.queue');
}

function getQueueFile() {
  return path.join(getQueueDir(), 'queue.json');
}

function getQueuePidFile() {
  return path.join(getQueueDir(), 'bg.pid');
}

function getPromptPidFile() {
  return promptStore.getPidFile();
}

function ensureQueueDir() {
  ensureTasksRoot();
  fs.mkdirSync(getQueueDir(), { recursive: true });
  if (!fs.existsSync(getQueueFile())) {
    fs.writeFileSync(getQueueFile(), JSON.stringify({ items: [] }, null, 2), 'utf8');
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

function isPidRunning(pid) {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function readTaskState(taskId) {
  const p = path.join(getTasksRoot(), taskId, 'task.json');
  return readJsonSafe(p, null);
}

function writeTaskState(taskId, state) {
  const p = path.join(getTasksRoot(), taskId, 'task.json');
  writeJsonAtomic(p, state);
}

function setTaskStatus(taskId, status, meta = {}) {
  const state = readTaskState(taskId);
  if (!state) return false;
  state.status = status;
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  state.runs.push({
    ts: new Date().toISOString(),
    event: 'status',
    status,
    ...meta,
  });
  writeTaskState(taskId, state);
  return true;
}

function writeTextFileAtomic(p, text) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, String(text || ''), 'utf8');
  fs.renameSync(tmp, p);
}

function clamp01(x) {
  const n = Number(x);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function suggestSp(issue) {
  const existing = issue.storyPoints ?? issue.originalStoryPoints ?? null;
  if (typeof existing === 'number' && existing > 0) return { suggested: existing, source: 'existing' };

  const type = issue.type?.key || '';
  if (type === 'bug') return { suggested: 1, source: 'heuristic' };
  if (type === 'incident') return { suggested: 2, source: 'heuristic' };
  if (type === 'newDocument') return { suggested: 0.5, source: 'heuristic' };
  return { suggested: 1, source: 'heuristic' };
}

function quickProbability(issue, spSuggested) {
  const queue = issue.queue?.key || '';
  const status = issue.status?.key || issue.statusType?.key || '';

  // Start from SP-based estimate
  let p = 0.55;
  if (spSuggested <= 1) p = 0.8;
  else if (spSuggested <= 2) p = 0.65;
  else if (spSuggested <= 4) p = 0.45;
  else p = 0.25;

  // Status adjustments
  if (['codeReview', 'readyForRelease', 'docOk'].includes(status)) p = Math.max(p, 0.85);
  if (['inProgress'].includes(status)) p = Math.min(p, 0.6);

  // Queue adjustments (security incidents may require extra coordination)
  if (queue === 'SECALERTS') p = Math.min(p, 0.25);

  return clamp01(p);
}

function formatProbability(p) {
  return `${Math.round(clamp01(p) * 100)}%`;
}

function estimateMyOpenIssues() {
  const issues = tracker.fetchMy({ openOnly: true });
  const now = new Date().toISOString();

  const items = issues.map((issue) => {
    const sp = suggestSp(issue);
    const qp = quickProbability(issue, sp.suggested);
    return {
      key: issue.key,
      summary: issue.summary || '',
      queue: issue.queue?.key || '',
      type: issue.type?.key || '',
      status: issue.status?.key || issue.statusType?.key || '',
      priority: issue.priority?.key || '',
      storyPointsExisting: issue.storyPoints ?? issue.originalStoryPoints ?? null,
      storyPointsSuggested: sp.suggested,
      storyPointsSource: sp.source,
      quickProbability: qp,
      updatedAt: issue.updatedAt || null,
    };
  });

  // Sort: highest quick probability first, then lowest SP
  items.sort((a, b) => {
    const dp = (b.quickProbability || 0) - (a.quickProbability || 0);
    if (dp !== 0) return dp;
    return (a.storyPointsSuggested || 0) - (b.storyPointsSuggested || 0);
  });

  return { generatedAt: now, count: items.length, items };
}

function enqueueTaskIds(taskIds) {
  ensureQueueDir();
  const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
  q.items = Array.isArray(q.items) ? q.items : [];

  const now = new Date().toISOString();
  const added = [];
  for (const id of taskIds) {
    if (!id) continue;
    q.items.push({ taskId: id, type: 'run', enqueuedAt: now });
    setTaskStatus(id, 'queued', { by: 'enqueue' });
    added.push(id);
  }

  writeJsonAtomic(getQueueFile(), q);
  return added;
}

function getWorkerNames() {
  const raw = Number.parseInt(process.env.DOCKER_WORKER_COUNT || process.env.DOCKER_PARALLEL_LIMIT || '2', 10);
  const count = Number.isFinite(raw) && raw > 0 ? raw : 2;
  return Array.from({ length: count }, (_, i) => `devduck-worker-${i + 1}`);
}

function makePrUrl(prId) {
  if (!prId) return null;
  return `https://a.yandex-team.ru/review/${prId}`;
}

function enqueueCiWait(taskId, prId, prUrl = null) {
  ensureQueueDir();
  const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
  q.items = Array.isArray(q.items) ? q.items : [];

  const now = new Date().toISOString();
  const url = prUrl || makePrUrl(prId);
  q.items.push({ taskId, type: 'ci-wait', prId, prUrl: url, enqueuedAt: now });
  writeJsonAtomic(getQueueFile(), q);
  return { taskId, prId, prUrl: url };
}

function markTaskWaitingForCi(taskId, prId, prUrl = null) {
  const state = readTaskState(taskId);
  if (!state) return { ok: false, reason: 'task_not_found' };
  const now = new Date().toISOString();
  const url = prUrl || state.pr?.url || makePrUrl(prId);

  state.status = 'ci_wait';
  state.stage = 'ci';
  state.pr = {
    ...(state.pr || {}),
    id: prId,
    url,
    ciStatus: 'running',
    updatedAt: now,
  };
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  state.runs.push({ ts: now, event: 'ci_wait', status: 'ci_wait', prId, prUrl: url });
  writeTaskState(taskId, state);
  return { ok: true, state };
}

function dequeueTaskId(taskId) {
  ensureQueueDir();
  const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
  q.items = Array.isArray(q.items) ? q.items : [];
  const before = q.items.length;
  q.items = q.items.filter((it) => it && it.taskId !== taskId);
  writeJsonAtomic(getQueueFile(), q);

  if (before !== q.items.length) {
    setTaskStatus(taskId, 'planned', { by: 'dequeue' });
    return true;
  }
  return false;
}

function slugifyAscii(input) {
  const s = String(input || '').toLowerCase();
  const slug = s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 40);
  return slug || 'task';
}

function extractIssueKeys(input) {
  const parts = String(input || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  for (const p of parts) {
    if (p.startsWith('http')) {
      const m = p.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
      if (m) out.push(m[1].toUpperCase());
      continue;
    }
    const m = p.match(/^([A-Z]+-\d+)$/i);
    if (m) out.push(m[1].toUpperCase());
  }

  return Array.from(new Set(out));
}

function getFlagValue(argv, flag, fallback = null) {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (!v || v.startsWith('-')) return fallback;
  return v;
}

function parseMode(raw, fallback = 'plan') {
  const v = String(raw || fallback).toLowerCase();
  if (v === 'plan' || v === 'prepare' || v === 'prepare-plan') return 'plan';
  if (v === 'execute' || v === 'implement') return 'execute';
  return fallback;
}

function splitFreeTextTasks(input) {
  // Semicolon acts as a task delimiter for free-text input:
  // `/task run "do A; do B; do C" --mode plan` => 3 tasks created.
  return String(input || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function writeTextTaskPlan({ id, text, mode }) {
  const status = mode === 'execute' ? 'executing' : 'planned';
  const base = [
    `# ${id}`,
    '',
    `**Status**: ${status}`,
    '',
    '## Description',
    '',
    String(text || '').trim(),
    '',
  ];

  if (mode === 'plan') {
    base.push(
      '## Resources',
      '',
      '- [ ] Add links / screenshots / logs if any',
      '',
      '## Questions for Clarification',
      '',
      '- [ ] What is the exact expected behavior?',
      '- [ ] What is the current behavior and where is it observed?',
      '- [ ] How to reproduce (steps, environment)?',
      '- [ ] What is the definition of done?',
      '',
      '## Implementation Plan',
      '',
      '- [ ] Collect context and narrow scope',
      '- [ ] Identify affected modules/files',
      '- [ ] Propose solution options + pick one',
      '- [ ] Implement minimal change',
      '- [ ] Add/adjust tests',
      '- [ ] Run at least one test',
      '- [ ] Prepare PR (if needed)',
      '',
    );
  } else {
    base.push(
      '## Execution Progress',
      '',
      '- [ ] Started',
      '- [ ] In progress',
      '- [ ] Done',
      '',
      '## Testing Plan',
      '',
      '- [ ] Add at least one test if possible',
      '- [ ] Run at least one test locally',
      '',
    );
  }

  return base.join('\n');
}

function createTextTask(text, mode = 'plan') {
  ensureTasksRoot();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = slugifyAscii(text);
  const id = `DD-${ts}-${slug}`;
  const dir = path.join(getTasksRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });

  const taskState = {
    id,
    type: 'info',
    status: mode === 'execute' ? 'executing' : 'planned',
    // Work stage (aligned with plan stages in scripts/plan.js). Best-effort default for free-text tasks.
    stage: mode === 'execute' ? 'execution_started' : 'initialized',
    branch: null,
    'last-fetch': null,
    ticket: null,
    pr: null,
    estimates: { sp: [], readiness: [] },
    ai_usage: [],
    runs: [],
    children: [],
    input: { text: String(text || '').trim() },
  };

  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(taskState, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'plan.md'), writeTextTaskPlan({ id, text, mode }), 'utf8');

  return { id, dir };
}

function listTasks() {
  ensureTasksRoot();
  const entries = fs.readdirSync(getTasksRoot(), { withFileTypes: true }).filter((e) => e.isDirectory());
  const tasks = [];
  for (const e of entries) {
    const p = path.join(getTasksRoot(), e.name, 'task.json');
    let state = null;
    try {
      state = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    } catch {
      state = null;
    }
    tasks.push({
      id: e.name,
      status: state?.status || 'unknown',
      type: state?.type || 'unknown',
      branch: state?.branch ?? null,
      lastFetch: state?.['last-fetch'] ?? null,
    });
  }
  return tasks;
}

function printUsage(code = 0) {
  // eslint-disable-next-line no-console
  console.error(
    [
      'Usage:',
      '  node scripts/task.js run <CRM-1234|url|\"free text\"> [--mode plan|execute] [--parallel] [--json] [--verbose]',
      '    - Tip: for free text, you can separate multiple tasks with `;`',
      '  node scripts/task.js enqueue <taskId|\"free text\"> [--mode plan|execute]',
      '  node scripts/task.js dequeue <taskId>',
      '  node scripts/task.js ci-wait <taskId> <prId> [prUrl]',
      '  node scripts/task.js bg start|status|stop',
      '  node scripts/task.js prompt enqueue <\"prompt text\">',
      '  node scripts/task.js prompt list [--limit N]',
      '  node scripts/task.js prompt bg start|status|stop',
      '  node scripts/task.js status [<taskId>]',
      '  node scripts/task.js list',
      '  node scripts/task.js logs <taskId>',
      '  node scripts/task.js workers status|stop|prune',
      '  node scripts/task.js fetch <CRM-1234|taskId>',
    ].join('\n'),
  );
  process.exit(code);
}

function main() {
  const rawArgs = process.argv.slice(2);

  // Handle EPIPE errors gracefully (e.g., when piped to head)
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
  });

  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    return printUsage(0);
  }

  const cmd = rawArgs[0];
  const args = rawArgs.slice(1);

  if (cmd === 'prompt') {
    const sub = args[0] || 'list';

    if (sub === 'enqueue') {
      const text = args.slice(1).join(' ').trim();
      if (!text) return printUsage(2);
      const item = promptStore.enqueuePrompt(text, { source: 'cli' });
      process.stdout.write(JSON.stringify({ ok: true, enqueued: item }, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
      return;
    }

    if (sub === 'list') {
      const rawLimit = getFlagValue(rawArgs, '--limit', '50');
      const limit = Number.parseInt(String(rawLimit || '50'), 10);
      const items = promptStore.listPrompts({ limit: Number.isFinite(limit) ? limit : 50 }).items;
      const state = promptStore.readState();
      const pidTxt = fs.existsSync(getPromptPidFile()) ? String(fs.readFileSync(getPromptPidFile(), 'utf8')).trim() : '';
      const pid = pidTxt ? Number(pidTxt) : null;
      const running = pid ? isPidRunning(pid) : false;
      process.stdout.write(JSON.stringify({ ok: true, running, pid, state, items }, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
      return;
    }

    if (sub === 'bg') {
      const action = args[1] || 'status';
      promptStore.ensureFiles();
      const pidPath = getPromptPidFile();

      if (action === 'status') {
        const pidTxt = fs.existsSync(pidPath) ? String(fs.readFileSync(pidPath, 'utf8')).trim() : '';
        const pid = pidTxt ? Number(pidTxt) : null;
        const running = pid ? isPidRunning(pid) : false;
        const q = promptStore.readQueue();
        const items = Array.isArray(q.items) ? q.items : [];
        const queued = items.filter((x) => x && x.status === 'queued').length;
        const processing = items.filter((x) => x && x.status === 'processing').length;
        process.stdout.write(JSON.stringify({ running, pid, queued, processing, total: items.length }, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
        return;
      }

      if (action === 'start') {
        const pidTxt = fs.existsSync(pidPath) ? String(fs.readFileSync(pidPath, 'utf8')).trim() : '';
        const existingPid = pidTxt ? Number(pidTxt) : null;
        if (existingPid && isPidRunning(existingPid)) {
          process.stdout.write(JSON.stringify({ ok: true, alreadyRunning: true, pid: existingPid }, null, 2));
          if (!process.stdout.isTTY) process.stdout.write('\n');
          return;
        }

        const logPath = path.join(promptStore.getPromptsDir(), 'bg.log');
        const out = fs.openSync(logPath, 'a');
        const child = spawn(process.execPath, [path.join(getProjectRoot(), 'scripts', 'prompt-worker.js')], {
          detached: true,
          stdio: ['ignore', out, out],
          env: process.env,
        });
        child.unref();
        fs.writeFileSync(pidPath, String(child.pid), 'utf8');
        process.stdout.write(JSON.stringify({ ok: true, started: true, pid: child.pid, logPath }, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
        return;
      }

      if (action === 'stop') {
        const pidTxt = fs.existsSync(pidPath) ? String(fs.readFileSync(pidPath, 'utf8')).trim() : '';
        const pid = pidTxt ? Number(pidTxt) : null;
        if (!pid) {
          process.stdout.write(JSON.stringify({ ok: true, stopped: false, reason: 'no_pid_file' }, null, 2));
          if (!process.stdout.isTTY) process.stdout.write('\n');
          return;
        }
        const running = isPidRunning(pid);
        if (running) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {}
        }
        try {
          fs.unlinkSync(pidPath);
        } catch {}
        process.stdout.write(JSON.stringify({ ok: true, stopped: running, pid }, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
        return;
      }

      return printUsage(2);
    }

    return printUsage(2);
  }

  if (cmd === 'list') {
    process.stdout.write(JSON.stringify({ tasks: listTasks() }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  if (cmd === 'status') {
    const id = args[0] || null;
    if (!id) {
      process.stdout.write(JSON.stringify({ tasks: listTasks() }, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
      return;
    }
    const p = path.join(getTasksRoot(), id, 'task.json');
    if (!fs.existsSync(p)) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    process.stdout.write(fs.readFileSync(p, 'utf8'));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  if (cmd === 'enqueue') {
    const mode = parseMode(getFlagValue(rawArgs, '--mode', 'plan'), 'plan');
    const input = args.filter((a) => a !== '--mode' && a !== mode).join(' ').trim();
    if (!input) return printUsage(2);

    ensureTasksRoot();
    const parts = splitFreeTextTasks(input);

    const toEnqueue = [];
    for (const part of parts) {
      // If it matches existing task dir, enqueue by id
      const existingDir = path.join(getTasksRoot(), part);
      if (fs.existsSync(existingDir) && fs.statSync(existingDir).isDirectory()) {
        toEnqueue.push(part);
        continue;
      }
      // Otherwise create a new free-text task and enqueue it
      const created = createTextTask(part, mode);
      toEnqueue.push(created.id);
    }

    const enqueued = enqueueTaskIds(toEnqueue);
    process.stdout.write(JSON.stringify({ enqueued, mode, count: enqueued.length }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  if (cmd === 'dequeue') {
    const id = args[0];
    if (!id) return printUsage(2);
    const ok = dequeueTaskId(id);
    process.stdout.write(JSON.stringify({ ok, taskId: id }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    process.exit(ok ? 0 : 1);
  }

  if (cmd === 'ci-wait') {
    const taskId = args[0];
    const prId = args[1];
    const prUrl = args[2] || null;
    if (!taskId || !prId) return printUsage(2);

    const marked = markTaskWaitingForCi(taskId, prId, prUrl);
    if (!marked.ok) {
      console.error(`Failed to mark task ${taskId} as waiting for CI (reason: ${marked.reason || 'unknown'})`);
      process.exit(1);
    }

    const queued = enqueueCiWait(taskId, prId, prUrl);
    process.stdout.write(JSON.stringify({ ok: true, taskId, prId, prUrl: queued.prUrl }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  if (cmd === 'bg') {
    const sub = args[0] || 'status';
    ensureQueueDir();
    const pidPath = getQueuePidFile();

    if (sub === 'status') {
      const pidTxt = fs.existsSync(pidPath) ? String(fs.readFileSync(pidPath, 'utf8')).trim() : '';
      const pid = pidTxt ? Number(pidTxt) : null;
      const running = pid ? isPidRunning(pid) : false;
      const q = readJsonSafe(getQueueFile(), { items: [] }) || { items: [] };
      const items = Array.isArray(q.items) ? q.items : [];
      process.stdout.write(JSON.stringify({ running, pid, queued: items.length, items }, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
      return;
    }

    if (sub === 'start') {
      const pidTxt = fs.existsSync(pidPath) ? String(fs.readFileSync(pidPath, 'utf8')).trim() : '';
      const existingPid = pidTxt ? Number(pidTxt) : null;
      if (existingPid && isPidRunning(existingPid)) {
        process.stdout.write(JSON.stringify({ ok: true, alreadyRunning: true, pid: existingPid }, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
        return;
      }

      const logPath = path.join(getQueueDir(), 'bg.log');
      const out = fs.openSync(logPath, 'a');
      const child = spawn(process.execPath, [path.join(getProjectRoot(), 'scripts', 'task-queue.js')], {
        detached: true,
        stdio: ['ignore', out, out],
        env: process.env,
      });
      child.unref();
      fs.writeFileSync(pidPath, String(child.pid), 'utf8');
      process.stdout.write(JSON.stringify({ ok: true, started: true, pid: child.pid, logPath }, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
      return;
    }

    if (sub === 'stop') {
      const pidTxt = fs.existsSync(pidPath) ? String(fs.readFileSync(pidPath, 'utf8')).trim() : '';
      const pid = pidTxt ? Number(pidTxt) : null;
      if (!pid) {
        process.stdout.write(JSON.stringify({ ok: true, stopped: false, reason: 'no_pid_file' }, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
        return;
      }
      const running = isPidRunning(pid);
      if (running) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {}
      }
      try {
        fs.unlinkSync(pidPath);
      } catch {}
      process.stdout.write(JSON.stringify({ ok: true, stopped: running, pid }, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
      return;
    }

    return printUsage(2);
  }

  if (cmd === 'logs') {
    const id = args[0];
    if (!id) return printUsage(2);
    const dir = path.join(getTasksRoot(), id, 'logs');
    if (!fs.existsSync(dir)) {
      console.error(`No logs dir: ${dir}`);
      process.exit(1);
    }
    const files = fs.readdirSync(dir).sort().slice(-20);
    process.stdout.write(JSON.stringify({ taskId: id, logsDir: dir, files }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  if (cmd === 'workers') {
    const sub = args[0] || 'status';
    const workerNames = getWorkerNames();
    if (sub === 'status') {
      const res = spawnSync('docker', ['ps', '-a', '--filter', 'name=devduck-worker-', '--format', '{{.Names}}\t{{.Status}}'], { encoding: 'utf8' });
      process.stdout.write(res.stdout || '');
      process.stderr.write(res.stderr || '');
      process.exit(res.status || 0);
    }
    if (sub === 'stop') {
      const res = spawnSync('docker', ['stop', ...workerNames, 'devduck-service'], { encoding: 'utf8' });
      process.stdout.write(res.stdout || '');
      process.stderr.write(res.stderr || '');
      process.exit(res.status || 0);
    }
    if (sub === 'prune') {
      const res = spawnSync('docker', ['rm', '-f', ...workerNames, 'devduck-service'], { encoding: 'utf8' });
      process.stdout.write(res.stdout || '');
      process.stderr.write(res.stderr || '');
      process.exit(res.status || 0);
    }
    return printUsage(2);
  }

  if (cmd === 'fetch') {
    const keyOrId = args[0];
    if (!keyOrId) return printUsage(2);
    const issueKeys = extractIssueKeys(keyOrId);
    if (issueKeys.length === 1) {
      const res = spawnSync('node', [path.join(getProjectRoot(), 'scripts', 'plan.js'), issueKeys[0]], { encoding: 'utf8' });
      process.stdout.write(res.stdout || '');
      process.stderr.write(res.stderr || '');
      process.exit(res.status || 0);
    }
    console.error('fetch currently supports only a single Tracker key/url');
    process.exit(2);
  }

  if (cmd === 'estimate-my') {
    const taskId = args[0];
    if (!taskId) return printUsage(2);
    const dir = path.join(getTasksRoot(), taskId);
    if (!fs.existsSync(dir)) {
      console.error(`Task not found: ${taskId}`);
      process.exit(1);
    }

    const report = estimateMyOpenIssues();
    const resourcesDir = path.join(dir, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    const jsonPath = path.join(resourcesDir, 'my-open-issues.estimates.json');
    writeJsonAtomic(jsonPath, report);

    const mdLines = [];
    mdLines.push(`# Estimates for open issues (assignee: me)`);
    mdLines.push('');
    mdLines.push(`Generated at: ${report.generatedAt}`);
    mdLines.push('');
    mdLines.push('| Key | SP (existing) | SP (suggested) | Quick | Queue | Status | Summary |');
    mdLines.push('|---|---:|---:|---:|---|---|---|');
    for (const it of report.items) {
      const spExisting = it.storyPointsExisting === null || it.storyPointsExisting === undefined ? '' : String(it.storyPointsExisting);
      mdLines.push(
        `| ${it.key} | ${spExisting} | ${it.storyPointsSuggested} | ${formatProbability(it.quickProbability)} | ${it.queue} | ${it.status} | ${String(it.summary).replace(/\|/g, '\\|')} |`,
      );
    }

    const mdPath = path.join(resourcesDir, 'my-open-issues.estimates.md');
    writeTextFileAtomic(mdPath, mdLines.join('\n') + '\n');

    // Persist a small summary into the task state
    const state = readTaskState(taskId);
    if (state) {
      state.estimates = state.estimates || { sp: [], readiness: [] };
      state.estimates.sp = Array.isArray(state.estimates.sp) ? state.estimates.sp : [];
      state.estimates.readiness = Array.isArray(state.estimates.readiness) ? state.estimates.readiness : [];
      state.estimates.sp.push({ ts: report.generatedAt, type: 'my_open_issues', count: report.count, items: report.items });
      state.estimates.readiness.push({ ts: report.generatedAt, type: 'my_open_issues', count: report.count, items: report.items.map((x) => ({ key: x.key, quickProbability: x.quickProbability })) });
      state.runs = Array.isArray(state.runs) ? state.runs : [];
      state.runs.push({ ts: report.generatedAt, event: 'estimate-my', outputs: { jsonPath, mdPath } });
      writeTaskState(taskId, state);
    }

    process.stdout.write(JSON.stringify({ ok: true, taskId, outputs: { jsonPath, mdPath }, count: report.count }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  if (cmd === 'run') {
    const mode = parseMode(getFlagValue(rawArgs, '--mode', 'plan'), 'plan');
    const input = args.filter((a) => a !== '--mode' && a !== mode).join(' ').trim();
    if (!input) return printUsage(2);

    const issueKeys = extractIssueKeys(input);
    if (issueKeys.length > 0) {
      // Delegate to docker runner (worker pool). Pass through flags.
      if (mode === 'execute') {
        console.error('execute mode for Tracker-backed tasks is not implemented yet; running plan mode instead');
      }
      const passthrough = rawArgs.filter((a) => ['--parallel', '--json', '--verbose'].includes(a));
      // For consistency: even a single issue should run in a dedicated plan container (plan-<issue>),
      // so it is visible in plan-status.js and has the same isolation model as multi-issue runs.
      const dedicated = issueKeys.length === 1 ? ['--dedicated'] : [];
      const res = spawnSync(
        'node',
        [path.join(getProjectRoot(), 'scripts', 'docker.js'), issueKeys.join(','), ...dedicated, ...passthrough],
        { encoding: 'utf8' },
      );
      process.stdout.write(res.stdout || '');
      process.stderr.write(res.stderr || '');
      process.exit(res.status || 0);
    }

    // Free-text task placeholder(s). Semicolon creates multiple tasks.
    const parts = splitFreeTextTasks(input);
    const created = parts.length <= 1 ? createTextTask(input, mode) : parts.map((p) => createTextTask(p, mode));
    process.stdout.write(JSON.stringify({ created, mode, count: Array.isArray(created) ? created.length : 1 }, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    return;
  }

  return printUsage(2);
}

if (require.main === module) {
  main();
}

