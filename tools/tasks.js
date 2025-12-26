#!/usr/bin/env node
/**
 * Minimal task tracker that treats TASKS.md as the source of truth.
 *
 * Design goals:
 * - No external deps
 * - Deterministic rewrite of the tasks table only
 * - Cheap to run and easy to audit in git diffs
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const TASKS_FILE = path.resolve(process.cwd(), 'TASKS.md');
const BEGIN = '<!-- TASKS:BEGIN -->';
const END = '<!-- TASKS:END -->';

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      flags[k] = v;
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

function normalizePrio(p) {
  if (!p) return 'P2';
  const v = String(p).toUpperCase();
  if (!/^P[0-3]$/.test(v)) die(`Invalid --prio "${p}". Expected P0..P3.`);
  return v;
}

function normalizeOwner(o) {
  if (!o) return '-';
  const v = String(o).trim();
  return v.length ? v : '-';
}

function escapeCell(s) {
  return String(s ?? '').replaceAll('\n', ' ').replaceAll('|', '\\|').trim();
}

function unescapeCell(s) {
  return String(s ?? '').replaceAll('\\|', '|').trim();
}

function nextId(rows) {
  const max = rows.reduce((m, r) => {
    const n = Number(String(r.id).replace(/^T/, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `T${String(max + 1).padStart(3, '0')}`;
}

function locateTasksRegion(md) {
  const b = md.indexOf(BEGIN);
  const e = md.indexOf(END);
  if (b === -1 || e === -1 || e < b) {
    die(`TASKS region markers not found in ${path.basename(TASKS_FILE)} (${BEGIN} ... ${END}).`);
  }
  return { beginIdx: b, endIdx: e + END.length };
}

function parseTableFromRegion(regionText) {
  // Region is expected to contain:
  // BEGIN
  // | header... |
  // | --- ... |
  // | row ... |
  // END
  const lines = regionText.split('\n').map((l) => l.trimEnd());
  const beginLine = lines.findIndex((l) => l.includes(BEGIN));
  const endLine = lines.findIndex((l) => l.includes(END));
  if (beginLine === -1 || endLine === -1 || endLine <= beginLine) die('Invalid TASKS region.');

  const tableLines = lines.slice(beginLine + 1, endLine).filter((l) => l.trim().length);
  const rowLines = tableLines.filter((l) => l.startsWith('|'));
  if (rowLines.length < 2) return [];

  // Skip header and separator
  const data = rowLines.slice(2);
  const rows = [];
  for (const line of data) {
    const parts = line
      .slice(1, -1)
      .split('|')
      .map((p) => unescapeCell(p));
    if (parts.length < 6) continue;
    const [id, status, prio, owner, title, note] = parts.map((x) => String(x).trim());
    if (!id) continue;
    rows.push({ id, status, prio, owner, title, note });
  }
  return rows;
}

function renderRegion(rows) {
  const lines = [];
  lines.push(BEGIN);
  lines.push('| id | status | prio | owner | title | note |');
  lines.push('|---:|:------:|:----:|:-----:|:------|:-----|');
  for (const r of rows) {
    lines.push(
      `| ${escapeCell(r.id)} | ${escapeCell(r.status)} | ${escapeCell(r.prio)} | ${escapeCell(
        r.owner
      )} | ${escapeCell(r.title)} | ${escapeCell(r.note)} |`
    );
  }
  lines.push(END);
  return `${lines.join('\n')}\n`;
}

function sortRows(rows) {
  const pr = (p) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[String(p).toUpperCase()] ?? 9);
  const st = (s) => ({ open: 0, claimed: 1, done: 2 }[String(s).toLowerCase()] ?? 9);
  const idn = (id) => Number(String(id).replace(/^T/, '')) || 0;
  return [...rows].sort((a, b) => pr(a.prio) - pr(b.prio) || st(a.status) - st(b.status) || idn(a.id) - idn(b.id));
}

async function loadMd() {
  try {
    return await fs.readFile(TASKS_FILE, 'utf8');
  } catch (e) {
    die(`Cannot read ${TASKS_FILE}. Create it first.`);
  }
}

async function saveMd(newMd) {
  await fs.writeFile(TASKS_FILE, newMd, 'utf8');
}

function printRows(rows) {
  const out = rows.map((r) => `${r.id}\t${r.status}\t${r.prio}\t${r.owner}\t${r.title}`).join('\n');
  process.stdout.write(out.length ? `${out}\n` : 'No tasks.\n');
}

async function main() {
  const { cmd, positional, flags } = parseArgs(process.argv);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(
      [
        'Usage:',
        '  node tools/tasks.js list',
        '  node tools/tasks.js add "title" --prio P2',
        '  node tools/tasks.js claim T001 --owner Lead',
        '  node tools/tasks.js done T001 --note "text"',
        '  node tools/tasks.js summary',
        '',
        `File: ${TASKS_FILE}`,
      ].join('\n') + '\n'
    );
    return;
  }

  const md = await loadMd();
  const { beginIdx, endIdx } = locateTasksRegion(md);
  const region = md.slice(beginIdx, endIdx);
  const rows = parseTableFromRegion(region);

  const byId = new Map(rows.map((r) => [r.id, r]));

  if (cmd === 'list') {
    const show = sortRows(rows).filter((r) => (flags.all ? true : r.status !== 'done'));
    printRows(show);
    return;
  }

  if (cmd === 'summary') {
    const counts = rows.reduce(
      (acc, r) => {
        acc.total += 1;
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      },
      { total: 0 }
    );
    process.stdout.write(
      `total=${counts.total} open=${counts.open || 0} claimed=${counts.claimed || 0} done=${counts.done || 0}\n`
    );
    return;
  }

  if (cmd === 'add') {
    const title = positional.join(' ').trim();
    if (!title) die('Provide a title: tasks add "title"');
    const id = nextId(rows);
    rows.push({
      id,
      status: 'open',
      prio: normalizePrio(flags.prio),
      owner: '-',
      title,
      note: `created ${nowIso()}`,
    });
  } else if (cmd === 'claim') {
    const id = positional[0];
    if (!id) die('Provide task id: tasks claim T001 --owner Lead');
    const r = byId.get(id);
    if (!r) die(`Task not found: ${id}`);
    if (String(r.status).toLowerCase() === 'done') die(`Task already done: ${id}`);
    r.status = 'claimed';
    r.owner = normalizeOwner(flags.owner);
    r.note = (flags.note ? String(flags.note) : r.note || '').trim() || `claimed ${nowIso()}`;
  } else if (cmd === 'done') {
    const id = positional[0];
    if (!id) die('Provide task id: tasks done T001 --note "text"');
    const r = byId.get(id);
    if (!r) die(`Task not found: ${id}`);
    r.status = 'done';
    if (flags.owner) r.owner = normalizeOwner(flags.owner);
    const extra = flags.note ? String(flags.note).trim() : '';
    r.note = extra.length ? extra : (r.note || `done ${nowIso()}`);
  } else {
    die(`Unknown command: ${cmd}. Try: list | add | claim | done | summary`);
  }

  const newRegion = renderRegion(sortRows(rows));
  const newMd = md.slice(0, beginIdx) + newRegion + md.slice(endIdx);
  await saveMd(newMd);
  process.stdout.write('OK\n');
}

main().catch((e) => {
  die(e?.stack || String(e));
});

