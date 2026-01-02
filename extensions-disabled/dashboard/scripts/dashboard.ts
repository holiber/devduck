/**
 * Ink-based terminal dashboard for Barducks tasks (no JSX, Node-compatible).
 *
 * Usage:
 *   tsx scripts/dashboard.ts
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { ComponentType } from 'react';
import type { RenderOptions } from 'ink';
import type { TextInputProps } from 'ink-text-input';

// Ink is ESM (may use top-level await), so load via dynamic import.
let render: (tree: React.ReactElement, options?: RenderOptions) => void;
let Box: ComponentType<{ flexDirection?: string; height?: number | string; width?: number | string; marginBottom?: number; marginTop?: number; flexGrow?: number }>;
let Text: ComponentType<{ color?: string; dimColor?: boolean; bold?: boolean; [key: string]: unknown }>;
let useInput: (handler: (input: string, key: { escape?: boolean; [key: string]: unknown }) => void) => void;
let useApp: () => { exit: () => void };
let TextInput: ComponentType<TextInputProps>;

const { getSnapshot } = await import('./dashboard-snapshot.js');
const { DashboardSnapshotSchema } = await import('../schemas/dashboard-snapshot.zod.js');
// TaskStateSchema not available - validation removed
const { createYargs } = await import('../../../src/lib/cli.js');

const h = React.createElement;

function safeNowIso(): string {
  return new Date().toISOString();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function shortId(id: string | null | undefined): string {
  const s = String(id || '');
  if (s.startsWith('DD-')) return s.slice(0, 16) + '…';
  if (s.length > 18) return s.slice(0, 18) + '…';
  return s;
}

function fmtCpu(cpuPct: number | null | undefined): string {
  if (typeof cpuPct !== 'number' || !Number.isFinite(cpuPct)) return '—';
  return `${cpuPct.toFixed(0)}%`;
}

function cpuColor(cpuPct: number | null | undefined): string {
  if (typeof cpuPct !== 'number' || !Number.isFinite(cpuPct)) return 'gray';
  if (cpuPct >= 80) return 'red';
  if (cpuPct >= 40) return 'yellow';
  if (cpuPct >= 5) return 'green';
  return 'gray';
}

function safeReadText(filePath: string, maxBytes = 60_000): string | null {
  try {
    const st = fs.statSync(filePath);
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function readTaskJson(taskDir: string): unknown {
  try {
    const p = path.join(taskDir, 'task.json');
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    // TaskStateSchema validation removed - schema not found
    return raw;
  } catch {
    return null;
  }
}

function isProblematicStatus(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'needs_manual';
}

function readinessColor(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'gray';
  // readiness is [0..10]
  if (v < 3.4) return 'red';
  if (v < 6.7) return 'yellow';
  return 'green';
}

function spColor(prev: number | null | undefined, curr: number | null | undefined): string {
  if (typeof curr !== 'number' || !Number.isFinite(curr)) return 'gray';
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return 'gray';
  if (curr === prev) return 'gray';
  // SP change is informational; highlight but not "good/bad" by default.
  return 'yellow';
}

interface RunTaskResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

function runTaskCmd(args: string[]): RunTaskResult {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const res = spawnSync(process.execPath, [path.join(__dirname, 'task.ts'), ...args], { encoding: 'utf8', stdio: 'pipe' });
  return { ok: res.status === 0, stdout: res.stdout || '', stderr: res.stderr || '', code: res.status || 0 };
}

function enqueuePrompt(promptText: string): RunTaskResult & { error?: string } {
  if (!String(promptText || '').trim()) return { ok: false, error: 'Empty prompt', stdout: '', stderr: '', code: 1 };
  return runTaskCmd(['prompt', 'enqueue', promptText]);
}

function ensureBgRunners(): void {
  // Best-effort: start task queue bg and prompt bg; ignore errors.
  runTaskCmd(['bg', 'start']);
  runTaskCmd(['prompt', 'bg', 'start']);
}

function openPathOnHost(p: string): boolean {
  const r = spawnSync('open', [p], { encoding: 'utf8', stdio: 'pipe' });
  return r.status === 0;
}

interface HeaderProps {
  snap: {
    taskStats?: { total?: number; byStatus?: Record<string, number> };
    queue?: { items?: unknown[]; runningTaskId?: string | null; bg?: { running?: boolean } };
    docker?: { ok?: boolean };
    prompts?: { counts?: { queued?: number; processing?: number }; bg?: { running?: boolean } };
    [key: string]: unknown;
  } | null;
}

function Header(props: HeaderProps) {
  const snap = props.snap || null;
  const byStatus = (snap && snap.taskStats && snap.taskStats.byStatus) || {};
  const queued = (snap && snap.queue && Array.isArray(snap.queue.items) ? snap.queue.items.length : 0) || 0;
  const runningTaskId = (snap && snap.queue && snap.queue.runningTaskId) || null;
  const bgRunning = !!(snap && snap.queue && snap.queue.bg && snap.queue.bg.running);
  const dockerOk = !!(snap && snap.docker && snap.docker.ok);
  const promptsQueued = (snap && snap.prompts && snap.prompts.counts && snap.prompts.counts.queued) || 0;
  const promptsProcessing = (snap && snap.prompts && snap.prompts.counts && snap.prompts.counts.processing) || 0;
  const promptsBg = !!(snap && snap.prompts && snap.prompts.bg && snap.prompts.bg.running);

  const parts: string[] = [];
  parts.push(`tasks:${(snap && snap.taskStats && snap.taskStats.total) || 0}`);
  parts.push(`queued:${queued}`);
  parts.push(`prompts:${promptsQueued}/${promptsProcessing}`);
  if (runningTaskId) parts.push(`running:${shortId(runningTaskId)}`);
  parts.push(`bg:${bgRunning ? 'on' : 'off'}`);
  parts.push(`pbg:${promptsBg ? 'on' : 'off'}`);
  parts.push(`docker:${dockerOk ? 'ok' : 'off'}`);

  const showStatuses = ['failed', 'needs_manual', 'executing', 'queued', 'planned', 'done'];
  const statusBits: string[] = [];
  for (const s of showStatuses) {
    if (byStatus[s]) statusBits.push(`${s}:${byStatus[s]}`);
  }

  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, null, 'Barducks Dashboard  ', h(Text, { dimColor: true }, parts.join(' | '))),
    statusBits.length ? h(Text, { dimColor: true }, statusBits.join('  ')) : null,
  );
}

interface TaskRowProps {
  task: {
    id: string;
    status?: string | null;
    stage?: string | null;
    branch?: string | null;
    sp?: { prev?: number | null; curr?: number | null; display?: string };
    readiness?: { curr?: number | null; display?: string };
    [key: string]: unknown;
  };
  width?: number;
}

function TaskRow(props: TaskRowProps) {
  const task = props.task;
  const width = props.width || 80;

  const status = task.status || 'unknown';
  const stage = task.stage || '—';
  const branch = task.branch || '—';
  const sp = task.sp && task.sp.display ? task.sp.display : '—';
  const readiness = task.readiness && task.readiness.display ? task.readiness.display : '—';

  const baseColor = isProblematicStatus(status) ? 'red' : undefined;

  const spPrev = task.sp ? task.sp.prev : null;
  const spCurr = task.sp ? task.sp.curr : null;
  const rCurr = task.readiness ? task.readiness.curr : null;

  // One-line status row (no selection/navigation).
  return h(
    Text,
    { color: baseColor },
    `${shortId(task.id)}  ${String(status).padEnd(12).slice(0, 12)}  ${String(stage).padEnd(16).slice(0, 16)}  ${String(branch).padEnd(28).slice(0, 28)}  `,
    h(Text, { color: spColor(spPrev, spCurr) }, String(sp).padEnd(7).slice(0, 7)),
    '  ',
    h(Text, { color: readinessColor(rCurr) }, String(readiness).padEnd(4).slice(0, 4)),
  );
}

interface PromptRowProps {
  prompt: {
    id?: string;
    status?: string;
    prompt?: string;
    [key: string]: unknown;
  };
  width?: number;
}

function PromptRow(props: PromptRowProps) {
  const p = props.prompt;
  const status = p.status || 'unknown';
  const id = String(p.id || '').slice(0, 14) + (String(p.id || '').length > 14 ? '…' : '');
  const text = String(p.prompt || '').replace(/\s+/g, ' ').slice(0, 70);
  const color = status === 'failed' ? 'red' : status === 'processing' ? 'yellow' : status === 'queued' ? 'cyan' : 'gray';
  return h(Text, { color }, `${id}  ${String(status).padEnd(10).slice(0, 10)}  ${text}`);
}

interface ContainerRowProps {
  c: {
    name?: string;
    kind?: string;
    cpuPct?: number | null;
    task?: string | null;
    taskName?: string | null;
    netIO?: string | null;
    [key: string]: unknown;
  };
  isSelected?: boolean;
  width?: number;
}

function ContainerRow(props: ContainerRowProps) {
  const c = props.c;
  const isSelected = !!props.isSelected;
  const width = props.width || 40;

  const sel = isSelected ? '›' : ' ';
  const name = c.name || '';
  const kind = String(c.kind || '').padEnd(6).slice(0, 6);
  const cpu = fmtCpu(c.cpuPct);
  const taskLabel = c.task || c.taskName || 'idle';
  const nameWithTask = `${name} ${taskLabel || 'idle'}`.trim();
  // Memory is intentionally de-emphasized (user requested it is not important).
  const net = c.netIO ? c.netIO : '—';
  const lineStart = `${sel} ${String(nameWithTask).padEnd(24).slice(0, 24)} ${kind} cpu:`;
  return h(
    Text,
    { color: isSelected ? 'cyan' : undefined },
    lineStart,
    h(Text, { color: cpuColor(c.cpuPct) }, String(cpu).padStart(4)),
    ` net:${net}`,
  );
}

interface EventsPaneProps {
  events: Array<{
    ts?: string;
    taskId?: string;
    message?: string;
    level?: string;
    [key: string]: unknown;
  }>;
  height?: number;
  width?: number;
}

function EventsPane(props: EventsPaneProps) {
  const events = Array.isArray(props.events) ? props.events : [];
  const height = props.height || 10;
  const width = props.width || 110;
  const slice = events.slice(0, height);

  return h(
    Box,
    { flexDirection: 'column' },
    h(Text, { dimColor: true }, 'Event log'),
    ...slice.map((e, idx) => {
      const ts = e.ts ? String(e.ts).replace('T', ' ').replace('Z', '') : '';
      const t = e.taskId ? shortId(e.taskId) : '';
      const msg = e.message || '';
      const line = `${ts} ${t} ${msg}`.trim().slice(0, width - 1);
      const color = e.level === 'error' ? 'red' : 'gray';
      return h(Text, { key: `${e.ts || idx}-${idx}`, color }, line);
    }),
  );
}

interface HelpBarProps {
  mode?: string;
}

function HelpBar(props: HelpBarProps) {
  const mode = props.mode || 'dashboard';
  const common = '↑/↓ move  Enter details  / search  t toggle-problem  q quit';
  if (mode === 'details') return h(Text, { dimColor: true }, `${common}  o open-folder  l view-log  r requeue  b back`);
  if (mode === 'search') return h(Text, { dimColor: true }, 'Type to filter, Enter apply, Esc cancel');
  if (mode === 'log') return h(Text, { dimColor: true }, 'Esc/backspace close');
  return h(Text, { dimColor: true }, common);
}

interface DetailsViewProps {
  task: {
    id: string;
    type?: string;
    status?: string;
    stage?: string | null;
    branch?: string | null;
    ticket?: { key?: string | null; summary?: string | null } | null;
    lastRun?: { ts?: string | null; event?: string | null; status?: string | null; ok?: boolean | null } | null;
    latestLog?: { file?: string } | null;
    sp?: { display?: string };
    readiness?: { display?: string };
    dir?: string;
    [key: string]: unknown;
  };
  message?: { level?: string; text?: string } | null;
}

function DetailsView(props: DetailsViewProps) {
  const task = props.task;
  const message = props.message || null;
  const ticket = task.ticket || null;
  const lastRun = task.lastRun || null;
  const sp = task.sp && task.sp.display ? task.sp.display : '—';
  const readiness = task.readiness && task.readiness.display ? task.readiness.display : '—';

  const msgNode = message
    ? h(
        Box,
        { marginBottom: 1 },
        h(Text, { color: message.level === 'error' ? 'red' : 'green' }, message.text),
      )
    : null;

  return h(
    Box,
    { flexDirection: 'column', height: '100%' },
    h(
      Box,
      { flexDirection: 'column', marginBottom: 1 },
      h(Text, null, h(Text, { color: 'cyan' }, task.id), '  ', h(Text, { dimColor: true }, task.type || '')),
      h(Text, null, 'status: ', h(Text, { bold: true }, task.status || 'unknown'), '  stage: ', h(Text, null, task.stage || '—'), '  branch: ', h(Text, null, task.branch || '—')),
      h(Text, null, 'SP: ', sp, '  readiness: ', readiness),
      ticket && ticket.key ? h(Text, null, 'ticket: ', ticket.key, '  ', ticket.summary || '') : h(Text, { dimColor: true }, 'ticket: —'),
      lastRun && lastRun.ts
        ? h(
            Text,
            null,
            'last: ',
            lastRun.ts,
            ' ',
            lastRun.event || '',
            ' ',
            lastRun.status || '',
            ' ',
            typeof lastRun.ok === 'boolean' ? (lastRun.ok ? 'ok' : 'fail') : '',
          )
        : h(Text, { dimColor: true }, 'last: —'),
      task.latestLog && task.latestLog.file ? h(Text, null, 'latest log: ', task.latestLog.file) : h(Text, { dimColor: true }, 'latest log: —'),
    ),
    msgNode,
    h(
      Box,
      { flexDirection: 'column', flexGrow: 1 },
      h(Text, { dimColor: true }, 'Actions: o=open folder, l=view log, r=requeue, b=back'),
      h(Text, { dimColor: true }, 'Folder: ', task.dir),
    ),
  );
}

interface LogViewProps {
  title?: string;
  content?: string;
}

function LogView(props: LogViewProps) {
  const title = props.title || 'log';
  const content = String(props.content || '');
  const lines = content.split('\n');
  const tail = lines.slice(-200);

  return h(
    Box,
    { flexDirection: 'column', height: '100%' },
    h(Text, { color: 'cyan' }, title),
    h(Text, { dimColor: true }, `Showing last ${tail.length} lines (tail)`),
    h(
      Box,
      { flexDirection: 'column', flexGrow: 1, marginTop: 1 },
      ...tail.map((l, idx) => h(Text, { key: idx }, l)),
    ),
  );
}

function App() {
  const { exit } = useApp();

  const [snap, setSnap] = React.useState<{
    taskStats?: { total?: number; byStatus?: Record<string, number> };
    queue?: { items?: unknown[]; runningTaskId?: string | null; bg?: { running?: boolean } };
    docker?: { ok?: boolean };
    prompts?: { items?: Array<{ id?: string; status?: string; prompt?: string; [key: string]: unknown }>; counts?: { queued?: number; processing?: number }; bg?: { running?: boolean } };
    tasks?: Array<{
      id: string;
      status?: string | null;
      stage?: string | null;
      branch?: string | null;
      sp?: { prev?: number | null; curr?: number | null; display?: string };
      readiness?: { curr?: number | null; display?: string };
      [key: string]: unknown;
    }>;
    containers?: Array<{
      name?: string;
      kind?: string;
      cpuPct?: number | null;
      task?: string | null;
      taskName?: string | null;
      netIO?: string | null;
      [key: string]: unknown;
    }>;
    events?: Array<{
      ts?: string;
      taskId?: string;
      message?: string;
      level?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<{ level?: string; text?: string } | null>(null);

  const [filterMode, setFilterMode] = React.useState(false);
  const [filterText, setFilterText] = React.useState('');
  const [problemOnly, setProblemOnly] = React.useState(false);
  const [promptMode, setPromptMode] = React.useState(false);
  const [promptText, setPromptText] = React.useState('');

  // One-screen dashboard only (no navigation).

  function refreshSnapshot(): void {
    try {
      const s = getSnapshot();
      const parsed = DashboardSnapshotSchema.safeParse(s);
      if (!parsed.success) {
        setError('Snapshot schema mismatch (non-fatal).');
        setSnap(s as typeof snap);
      } else {
        setError(null);
        setSnap(parsed.data as typeof snap);
      }
      setLastUpdatedAt(safeNowIso());
    } catch (e) {
      const err = e as { message?: string };
      setError(err && err.message ? err.message : 'Failed to get snapshot');
    }
  }

  React.useEffect(() => {
    refreshSnapshot();
    const t = setInterval(refreshSnapshot, 1000);
    return () => clearInterval(t);
  }, []);

  const tasksAll = (snap && Array.isArray(snap.tasks) ? snap.tasks : []) || [];
  const tasksFiltered = tasksAll.filter((t) => {
    if (problemOnly && !isProblematicStatus(t.status)) return false;
    if (!filterText) return true;
    const hay = `${t.id} ${t.status || ''} ${t.stage || ''} ${t.branch || ''}`.toLowerCase();
    return hay.includes(filterText.toLowerCase());
  });

  const containersAll = (snap && Array.isArray(snap.containers) ? snap.containers : []) || [];
  const promptsAll = (snap && snap.prompts && Array.isArray(snap.prompts.items) ? snap.prompts.items : []) || [];

  useInput((input, key) => {
    if (filterMode) {
      if (key.escape) {
        setFilterMode(false);
        setFilterText('');
      }
      return;
    }

    if (promptMode) {
      if (key.escape) {
        setPromptMode(false);
        setPromptText('');
      }
      return;
    }

    // Exit on Esc globally (requested)
    if (key.escape) exit();
    if (input === 'q') exit();

    // Dashboard view
    if (input === '/') {
      setFilterMode(true);
      return;
    }
    if (input === 'p') {
      setPromptMode(true);
      setPromptText('');
      return;
    }
    if (input === 't') {
      setProblemOnly((x) => !x);
      return;
    }
  });

  // Fixed layout for a stable MVP.
  const width = 100;
  const containersWidth = width;
  const tasksWidth = width;
  const eventsHeight = 10;
  const headerHeight = 2;
  const footerHeight = 1;
  const mainHeight = 30;
  const tasksHeight = mainHeight - eventsHeight - 1;
  const promptsHeight = 6;

  const filterBar = filterMode
    ? h(
        Box,
        { marginBottom: 1 },
        h(Text, { dimColor: true }, 'filter: '),
        h(TextInput, {
          value: filterText,
          onChange: setFilterText,
          onSubmit: () => {
            setFilterMode(false);
          },
        }),
      )
    : null;

  const promptBar = promptMode
    ? h(
        Box,
        { marginBottom: 1 },
        h(Text, { dimColor: true }, 'prompt: '),
        h(TextInput, {
          value: promptText,
          onChange: setPromptText,
          onSubmit: () => {
            const res = enqueuePrompt(promptText);
            setFlash({
              level: res.ok ? 'info' : 'error',
              text: res.ok ? 'Prompt enqueued' : `Failed to enqueue prompt: ${String(res.stderr || res.stdout || 'unknown error').trim()}`,
            });
            setPromptMode(false);
            setPromptText('');
          },
        }),
      )
    : null;

  const flashBar = flash
    ? h(
        Box,
        { marginBottom: 1 },
        h(Text, { color: flash.level === 'error' ? 'red' : 'green' }, flash.text),
      )
    : null;

  const taskRows = tasksFiltered.slice(0, tasksHeight).map((t) => TaskRow({ key: t.id, task: t, width: tasksWidth }));

  const containerRows = containersAll.slice(0, 4).map((c) => ContainerRow({ key: c.name, c, isSelected: false, width: containersWidth }));
  const promptRows = promptsAll.slice(0, promptsHeight).map((p) => PromptRow({ key: p.id, prompt: p, width }));

  return h(
    Box,
    { flexDirection: 'column', width },
    h(
      Box,
      { height: headerHeight, flexDirection: 'column' },
      Header({ snap }),
      error ? h(Text, { color: 'red' }, error) : h(Text, { dimColor: true }, `updated: ${lastUpdatedAt || '—'}`),
    ),
    filterBar,
    promptBar,
    flashBar,
    h(Text, { dimColor: true }, 'Containers'),
    h(Box, { flexDirection: 'column', width: containersWidth }, ...containerRows, !containersAll.length ? h(Text, { dimColor: true }, '(no containers)') : null),
    h(Box, { marginTop: 1 }),
    h(Text, { dimColor: true }, 'Prompts (pending processing)'),
    h(Box, { flexDirection: 'column', height: promptsHeight }, ...promptRows, !promptsAll.length ? h(Text, { dimColor: true }, '(no prompts)') : null),
    h(Box, { marginTop: 1 }),
    h(Text, { dimColor: true }, `Tasks ${problemOnly ? '(problematic only)' : ''} ${filterText ? `(filter: ${filterText})` : ''}`.trim()),
    h(Text, { dimColor: true }, 'id               status         stage            branch                       sp       readiness'),
    h(Box, { flexDirection: 'column', height: tasksHeight }, ...taskRows, !tasksFiltered.length ? h(Text, { dimColor: true }, '(no tasks)') : null),
    h(
      Box,
      { height: eventsHeight, width, flexDirection: 'column', marginTop: 1 },
      EventsPane({ events: (snap && snap.events) || [], height: eventsHeight, width }),
    ),
    h(
      Box,
      { height: footerHeight },
      h(
        Text,
        { dimColor: true },
        promptMode
          ? 'Type prompt, Enter enqueue, Esc closes'
          : filterMode
            ? 'Type to filter, Enter apply, Esc exits'
            : 'Esc/q quit   / filter   p prompt   t toggle-problem',
      ),
    ),
  );
}

async function main(): Promise<void> {
  const args = await createYargs(process.argv)
    .scriptName('dashboard')
    .strict()
    .usage('Usage: $0 [--prompt "<text>"]\n\nLaunch Barducks dashboard (Ink TUI).')
    .option('prompt', {
      type: 'string',
      describe: 'Enqueue a prompt before launching the dashboard',
      default: '',
    })
    .parseAsync();

  ensureBgRunners();
  if (args.prompt) {
    enqueuePrompt(args.prompt as string);
  }

  const ink = await import('ink');
  render = ink.render;
  Box = ink.Box;
  Text = ink.Text;
  useInput = ink.useInput;
  useApp = ink.useApp;

  const textInputMod = await import('ink-text-input');
  TextInput = textInputMod.default;

  render(h(App));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  const error = e as { stack?: string };
  console.error(error && error.stack ? error.stack : String(e));
  process.exitCode = 1;
});

