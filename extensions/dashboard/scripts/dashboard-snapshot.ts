/**
 * Snapshot collector for DevDuck dashboard.
 *
 * Reads task state from:
 * - .cache/tasks/<taskId>/task.json
 * - .cache/tasks/.queue/queue.json, state.json, bg.pid
 *
 * And container stats from Docker:
 * - docker ps (workers: devduck-worker-*, plans: plan-*)
 * - docker stats --no-stream
 *
 * Outputs a single JSON snapshot for consumption by the Ink TUI.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
// @ts-expect-error - prompt-store may not have types
import promptStore from '../../core/scripts/prompt-store.js';
import { createYargs, installEpipeHandler } from '../../../src/lib/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function getTasksRoot(): string {
  return path.join(getProjectRoot(), '.cache', 'tasks');
}

function getQueueDir(): string {
  return path.join(getTasksRoot(), '.queue');
}

function getQueueFile(): string {
  return path.join(getQueueDir(), 'queue.json');
}

function getQueueStateFile(): string {
  return path.join(getQueueDir(), 'state.json');
}

function getQueuePidFile(): string {
  return path.join(getQueueDir(), 'bg.pid');
}

function getWorkerStateFile(): string {
  return path.join(getQueueDir(), 'workers.json');
}

interface PromptsSnapshot {
  ok: boolean;
  counts: {
    total: number;
    queued: number;
    processing: number;
    done: number;
    failed: number;
  };
  items: Array<{ status?: string; [key: string]: unknown }>;
  state: {
    runningPromptId: string | null;
    since: string | null;
  };
  bg: {
    pid: number | null;
    running: boolean;
  };
  error?: string;
}

function readPromptsSnapshot(): PromptsSnapshot {
  // Prompt queue is a separate pre-task queue. It lives under `.cache/tasks/.prompts/`.
  try {
    promptStore.ensureFiles();
    const q = promptStore.readQueue() as { items?: Array<{ status?: string; [key: string]: unknown }> };
    const items = Array.isArray(q.items) ? q.items : [];
    const state = promptStore.readState() as { runningPromptId?: string | null; since?: string | null };

    const pidPath = promptStore.getPidFile();
    const pidTxt = fs.existsSync(pidPath) ? safeTrim(fs.readFileSync(pidPath, 'utf8')) : '';
    const pid = pidTxt ? Number(pidTxt) : null;
    const running = pid ? isPidRunning(pid) : false;

    const counts = {
      total: items.length,
      queued: items.filter((x) => x && x.status === 'queued').length,
      processing: items.filter((x) => x && x.status === 'processing').length,
      done: items.filter((x) => x && x.status === 'done').length,
      failed: items.filter((x) => x && x.status === 'failed').length,
    };

    const recent = items.slice(-20).reverse();

    return {
      ok: true,
      counts,
      items: recent,
      state: {
        runningPromptId: state.runningPromptId || null,
        since: state.since || null
      },
      bg: { pid: pid || null, running },
    };
  } catch (e) {
    const error = e as { message?: string };
    return {
      ok: false,
      counts: { total: 0, queued: 0, processing: 0, done: 0, failed: 0 },
      items: [],
      state: { runningPromptId: null, since: null },
      bg: { pid: null, running: false },
      error: error && error.message ? error.message : 'prompt snapshot failed',
    };
  }
}

function readJsonSafe<T>(p: string, fallback: T): T {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function isPidRunning(pid: number): boolean {
  if (!pid || Number.isNaN(Number(pid))) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function safeTrim(s: string | null | undefined): string {
  return String(s || '').trim();
}

function parseDockerTable(output: string): string[] {
  const lines = safeTrim(output).split('\n').filter((l) => l.trim());
  return lines;
}

interface DockerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runDocker(args: string[]): DockerResult {
  const res = spawnSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
  if (res.status !== 0) {
    return { ok: false, stdout: res.stdout || '', stderr: res.stderr || '' };
  }
  return { ok: true, stdout: res.stdout || '', stderr: res.stderr || '' };
}

interface ContainerInfo {
  name: string;
  kind: string;
  status: string;
  image: string;
}

interface ListContainersResult {
  containers: ContainerInfo[];
  dockerOk: boolean;
  error: string | null;
}

function listDockerContainers(): ListContainersResult {
  // One command with name filters keeps it cheap.
  const r = runDocker([
    'ps',
    '--filter',
    'name=devduck-worker-',
    '--filter',
    'name=plan-',
    '--filter',
    'name=barducks-service',
    '--format',
    '{{.Names}}\t{{.Status}}\t{{.Image}}',
  ]);

  if (!r.ok) return { containers: [], dockerOk: false, error: safeTrim(r.stderr || r.stdout) || 'docker ps failed' };

  const lines = parseDockerTable(r.stdout);
  const containers: ContainerInfo[] = [];
  for (const line of lines) {
    const [name, status, image] = line.split('\t');
    if (!name) continue;
    const kind = name.startsWith('devduck-worker-')
      ? 'worker'
      : name.startsWith('plan-')
        ? 'plan'
        : name === 'barducks-service'
          ? 'service'
          : 'other';
    containers.push({
      name,
      kind,
      status: safeTrim(status),
      image: safeTrim(image),
    });
  }

  return { containers, dockerOk: true, error: null };
}

interface ContainerStats {
  cpu: string;
  cpuPct: number | null;
  mem: string;
  netIO: string;
  blockIO: string;
}

interface DockerStatsResult {
  statsByName: Record<string, ContainerStats>;
  dockerOk: boolean;
  error: string | null;
}

function getDockerStats(names: string[]): DockerStatsResult {
  if (!names.length) return { statsByName: {}, dockerOk: true, error: null };

  // docker stats format fields are already human friendly; we keep strings and also parse CPU%.
  const r = runDocker([
    'stats',
    '--no-stream',
    '--format',
    '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}',
    ...names,
  ]);
  if (!r.ok) return { statsByName: {}, dockerOk: false, error: safeTrim(r.stderr || r.stdout) || 'docker stats failed' };

  const statsByName: Record<string, ContainerStats> = {};
  for (const line of parseDockerTable(r.stdout)) {
    const [name, cpu, memUsage, netIO, blockIO] = line.split('\t');
    if (!name) continue;
    const cpuPct = Number.parseFloat(String(cpu || '').replace('%', '').trim());
    statsByName[name] = {
      cpu: safeTrim(cpu),
      cpuPct: Number.isFinite(cpuPct) ? cpuPct : null,
      mem: safeTrim(memUsage),
      netIO: safeTrim(netIO),
      blockIO: safeTrim(blockIO),
    };
  }

  return { statsByName, dockerOk: true, error: null };
}

function listTaskDirs(tasksRoot: string): string[] {
  if (!fs.existsSync(tasksRoot)) return [];
  try {
    return fs
      .readdirSync(tasksRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name !== '.queue');
  } catch {
    return [];
  }
}

interface LatestLogInfo {
  latestLog: {
    file: string;
    path: string;
  } | null;
}

function readLatestLogInfo(taskDir: string): LatestLogInfo {
  const logsDir = path.join(taskDir, 'logs');
  if (!fs.existsSync(logsDir)) return { latestLog: null };
  try {
    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log')).sort();
    if (!files.length) return { latestLog: null };
    const latest = files[files.length - 1];
    return { latestLog: { file: latest, path: path.join(logsDir, latest) } };
  } catch {
    return { latestLog: null };
  }
}

interface NormalizedTicket {
  key: string | null;
  summary: string | null;
  status: string | null;
  url: string | null;
}

function normalizeTicket(taskState: { ticket?: { key?: string; summary?: string; statusType?: { display?: string; key?: string }; status?: { display?: string; key?: string } } | null } | null): NormalizedTicket | null {
  const t = taskState && taskState.ticket ? taskState.ticket : null;
  if (!t) return null;
  return {
    key: t.key || null,
    summary: t.summary || null,
    status: (t.statusType && (t.statusType.display || t.statusType.key)) || (t.status && (t.status.display || t.status.key)) || null,
    url: t.key ? `https://st.yandex-team.ru/${t.key}` : null,
  };
}

function extractNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

interface LastTwoNumbers {
  prev: number | null;
  curr: number | null;
}

function pickLastTwoNumbers(points: Array<{ value?: number; [key: string]: unknown }>): LastTwoNumbers {
  const nums = points.filter((p) => p && typeof p.value === 'number' && Number.isFinite(p.value));
  if (nums.length === 0) return { prev: null, curr: null };
  if (nums.length === 1) return { prev: null, curr: nums[0].value! };
  return { prev: nums[nums.length - 2].value!, curr: nums[nums.length - 1].value! };
}

interface Metrics {
  sp: {
    prev: number | null;
    curr: number | null;
    display: string;
  };
  readiness: {
    prev: number | null;
    curr: number | null;
    display: string;
  };
}

function deriveMetricsFromEstimates(taskState: {
  ticket?: { key?: string };
  estimates?: {
    sp?: Array<{
      ts?: string;
      items?: Array<{
        key?: string;
        storyPointsExisting?: number;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    }>;
    readiness?: Array<{
      ts?: string;
      items?: Array<{
        key?: string;
        quickProbability?: number;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
} | null): Metrics {
  const ticketKey = taskState && taskState.ticket && taskState.ticket.key ? String(taskState.ticket.key) : null;
  const estimates = taskState && taskState.estimates ? taskState.estimates : null;

  const out: Metrics = {
    sp: { prev: null, curr: null, display: '—' },
    readiness: { prev: null, curr: null, display: '—' },
  };

  if (!ticketKey || !estimates) return out;

  const spHistory: Array<{ ts: string | null; value: number }> = [];
  const spArr = Array.isArray(estimates.sp) ? estimates.sp : [];
  for (const entry of spArr) {
    const items = entry && Array.isArray(entry.items) ? entry.items : [];
    const it = items.find((x) => x && x.key === ticketKey);
    if (!it) continue;
    // Primary: current story points from Tracker at the time of snapshot
    const v = extractNumber(it.storyPointsExisting);
    if (v === null) continue;
    spHistory.push({ ts: entry.ts || null, value: v });
  }
  spHistory.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const spLastTwo = pickLastTwoNumbers(spHistory);
  out.sp.prev = spLastTwo.prev;
  out.sp.curr = spLastTwo.curr;
  out.sp.display =
    spLastTwo.curr === null
      ? '—'
      : spLastTwo.prev === null || spLastTwo.prev === spLastTwo.curr
        ? String(spLastTwo.curr)
        : `${spLastTwo.prev} > ${spLastTwo.curr}`;

  const readinessHistory: Array<{ ts: string | null; value: number }> = [];
  const rArr = Array.isArray(estimates.readiness) ? estimates.readiness : [];
  for (const entry of rArr) {
    const items = entry && Array.isArray(entry.items) ? entry.items : [];
    const it = items.find((x) => x && x.key === ticketKey);
    if (!it) continue;
    const v = extractNumber(it.quickProbability);
    if (v === null) continue;
    // Stored as quickProbability in [0..1]. Convert to readiness in [0..10].
    readinessHistory.push({ ts: entry.ts || null, value: v * 10 });
  }
  readinessHistory.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const rLastTwo = pickLastTwoNumbers(readinessHistory);
  out.readiness.prev = rLastTwo.prev;
  out.readiness.curr = rLastTwo.curr;
  out.readiness.display = rLastTwo.curr === null ? '—' : `${rLastTwo.curr.toFixed(1)}`;

  return out;
}

interface LastRun {
  ts: string | null;
  event: string | null;
  status: string | null;
  ok: boolean | null;
  logPath: string | null;
}

function getLastRun(taskState: { runs?: Array<{ ts?: string; event?: string; status?: string; ok?: boolean; logPath?: string; [key: string]: unknown }> } | null): LastRun | null {
  const runs = taskState && Array.isArray(taskState.runs) ? taskState.runs : [];
  if (!runs.length) return null;
  const last = runs[runs.length - 1];
  return {
    ts: last.ts || null,
    event: last.event || null,
    status: last.status || null,
    ok: typeof last.ok === 'boolean' ? last.ok : null,
    logPath: last.logPath || null,
  };
}

interface TaskEvent {
  ts: string;
  source: string;
  taskId: string;
  level: string;
  message: string;
}

function collectTaskEvents(tasks: Array<{ id: string; _rawRuns?: Array<{ ts?: string; event?: string; status?: string; ok?: boolean; [key: string]: unknown }> }>): TaskEvent[] {
  // Build a small timeline from task.runs[] and queue events.
  const events: TaskEvent[] = [];
  for (const t of tasks) {
    const runs = Array.isArray(t._rawRuns) ? t._rawRuns : [];
    for (const r of runs.slice(-10)) {
      const ts = r.ts || null;
      if (!ts) continue;
      const msgParts: string[] = [];
      if (r.event) msgParts.push(String(r.event));
      if (r.status) msgParts.push(`status=${r.status}`);
      if (typeof r.ok === 'boolean') msgParts.push(r.ok ? 'ok' : 'fail');
      events.push({
        ts: String(ts),
        source: 'task',
        taskId: t.id,
        level: r.status === 'failed' || r.ok === false ? 'error' : 'info',
        message: msgParts.join(' '),
      });
    }
  }
  events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  return events.slice(0, 50);
}

interface StatusCounts {
  total: number;
  byStatus: Record<string, number>;
}

function computeStatusCounts(tasks: Array<{ status?: string }>): StatusCounts {
  const byStatus: Record<string, number> = {};
  for (const t of tasks) {
    const s = t.status || 'unknown';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return { total: tasks.length, byStatus };
}

interface Task {
  id: string;
  dir: string;
  type: string;
  status: string;
  stage: string | null;
  branch: string | null;
  lastFetch: string | null;
  ticket: NormalizedTicket | null;
  lastRun: LastRun | null;
  latestLog: {
    file: string;
    path: string;
  } | null;
  sp: {
    prev: number | null;
    curr: number | null;
    display: string;
  };
  readiness: {
    prev: number | null;
    curr: number | null;
    display: string;
  };
  _rawRuns?: Array<{ ts?: string; event?: string; status?: string; ok?: boolean; [key: string]: unknown }>;
}

function collectTasks(): Task[] {
  const tasksRoot = getTasksRoot();
  const dirs = listTaskDirs(tasksRoot);
  const tasks: Task[] = [];
  for (const dirName of dirs) {
    const dir = path.join(tasksRoot, dirName);
    const taskJsonPath = path.join(dir, 'task.json');
    const state = readJsonSafe(taskJsonPath, null) as {
      type?: string;
      status?: string;
      stage?: string | null;
      branch?: string | null;
      'last-fetch'?: string | null;
      ticket?: { key?: string; summary?: string; statusType?: { display?: string; key?: string }; status?: { display?: string; key?: string } } | null;
      runs?: Array<{ ts?: string; event?: string; status?: string; ok?: boolean; logPath?: string; [key: string]: unknown }>;
      estimates?: {
        sp?: Array<{ ts?: string; items?: Array<{ key?: string; storyPointsExisting?: number; [key: string]: unknown }>; [key: string]: unknown }>;
        readiness?: Array<{ ts?: string; items?: Array<{ key?: string; quickProbability?: number; [key: string]: unknown }>; [key: string]: unknown }>;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    } | null;

    const ticket = normalizeTicket(state);
    const lastRun = getLastRun(state);
    const latestLog = readLatestLogInfo(dir).latestLog;
    const metrics = deriveMetricsFromEstimates(state);

    tasks.push({
      id: dirName,
      dir,
      type: (state && state.type) || 'unknown',
      status: (state && state.status) || 'unknown',
      stage: (state && Object.prototype.hasOwnProperty.call(state, 'stage') ? state.stage : null) || null,
      branch: (state && state.branch) || null,
      lastFetch: (state && state['last-fetch']) || null,
      ticket,
      lastRun,
      latestLog,
      sp: metrics.sp,
      readiness: metrics.readiness,
      _rawRuns: (state && state.runs) || [],
    });
  }

  // Sort: problematic first, then executing/queued, then recent activity.
  const statusRank = (s: string): number => {
    if (s === 'failed') return 0;
    if (s === 'needs_manual') return 1;
    if (s === 'executing') return 2;
    if (s === 'queued') return 3;
    if (s === 'planned') return 4;
    if (s === 'done') return 9;
    return 5;
  };

  tasks.sort((a, b) => {
    const ra = statusRank(a.status);
    const rb = statusRank(b.status);
    if (ra !== rb) return ra - rb;
    const ta = (a.lastRun && a.lastRun.ts) || a.lastFetch || '';
    const tb = (b.lastRun && b.lastRun.ts) || b.lastFetch || '';
    return String(tb).localeCompare(String(ta));
  });

  return tasks;
}

interface QueueInfo {
  items: Array<unknown>;
  runningTaskId: string | null;
  since: string | null;
  bg: {
    pid: number | null;
    running: boolean;
  };
}

function collectQueue(): QueueInfo {
  const q = readJsonSafe<{ items?: Array<unknown> }>(getQueueFile(), { items: [] }) || { items: [] };
  const items = Array.isArray(q.items) ? q.items : [];
  const state = readJsonSafe<{ runningTaskId?: string | null; since?: string | null }>(getQueueStateFile(), { runningTaskId: null, since: null }) || { runningTaskId: null, since: null };

  const pidTxt = fs.existsSync(getQueuePidFile()) ? safeTrim(fs.readFileSync(getQueuePidFile(), 'utf8')) : '';
  const pid = pidTxt ? Number(pidTxt) : null;
  const running = pid ? isPidRunning(pid) : false;

  return {
    items,
    runningTaskId: state.runningTaskId || null,
    since: state.since || null,
    bg: { pid: pid || null, running },
  };
}

function readWorkerState(): { workers: Record<string, { taskId?: string; [key: string]: unknown }> } {
  return readJsonSafe<{ workers?: Record<string, { taskId?: string; [key: string]: unknown }> }>(getWorkerStateFile(), { workers: {} }) || { workers: {} };
}

function deriveTaskLabel(container: ContainerInfo, workerState: { workers?: Record<string, { taskId?: string; [key: string]: unknown }> }): string | null {
  const workers = workerState && workerState.workers ? workerState.workers : {};
  if (container.kind === 'worker') {
    const ws = workers[container.name] || null;
    if (ws && ws.taskId) return ws.taskId;
    return 'idle';
  }
  if (container.kind === 'plan') {
    const issue = container.name.replace(/^plan-/, '').replace(/_/g, '-').toUpperCase();
    return issue || null;
  }
  if (container.kind === 'service') return 'ci-watcher';
  return null;
}

interface ContainersInfo {
  dockerOk: boolean;
  containers: Array<ContainerInfo & {
    cpu: string | null;
    cpuPct: number | null;
    mem: string | null;
    netIO: string | null;
    blockIO: string | null;
    task: string | null;
  }>;
  errors: string[];
}

function collectContainers(): ContainersInfo {
  const listed = listDockerContainers();
  const names = listed.containers.map((c) => c.name);
  const stats = getDockerStats(names);
  const workerState = readWorkerState();

  const dockerOk = listed.dockerOk && stats.dockerOk;
  const errors: string[] = [];
  if (!listed.dockerOk && listed.error) errors.push(listed.error);
  if (!stats.dockerOk && stats.error) errors.push(stats.error);

  const containers = listed.containers.map((c) => {
    const s = stats.statsByName[c.name] || null;
    const task = deriveTaskLabel(c, workerState);
    return {
      ...c,
      cpu: s ? s.cpu : null,
      cpuPct: s ? s.cpuPct : null,
      mem: s ? s.mem : null,
      netIO: s ? s.netIO : null,
      blockIO: s ? s.blockIO : null,
      task,
    };
  });

  return { dockerOk, containers, errors };
}

export function getSnapshot() {
  const generatedAt = new Date().toISOString();
  const tasksRoot = getTasksRoot();

  const tasks = collectTasks();
  const queue = collectQueue();
  const containersInfo = collectContainers();
  const prompts = readPromptsSnapshot();

  const statusCounts = computeStatusCounts(tasks);
  const events = collectTaskEvents(tasks);

  // Strip internal fields
  for (const t of tasks) delete t._rawRuns;

  return {
    version: 1,
    generatedAt,
    tasksRoot,
    queue,
    prompts,
    taskStats: statusCounts,
    tasks,
    containers: containersInfo.containers,
    docker: {
      ok: containersInfo.dockerOk,
      errors: containersInfo.errors,
    },
    events,
  };
}

function main(): void {
  installEpipeHandler();

  createYargs(process.argv)
    .scriptName('dashboard-snapshot')
    .strict()
    .usage('Usage: $0\n\nAlways outputs JSON snapshot.')
    .command(
      '$0',
      'Output a JSON snapshot for the dashboard.',
      (y) => y,
      () => {
        const snap = getSnapshot();
        process.stdout.write(JSON.stringify(snap, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
      },
    )
    .parse();
}

// Run main function if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

