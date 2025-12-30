#!/usr/bin/env node
/**
 * Print a markdown table with per-test timings (baseline vs current).
 *
 * Intended for task docs / PR notes, not for CI enforcement.
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import type { ParsedNodeTestReport } from '../../src/perf/node-test-parse.js';

type PwJson = {
  suites?: Array<any>;
};

type Row = {
  suite: 'unit' | 'pw_installer';
  name: string;
  baselineMs: number | null;
  currentMs: number | null;
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return 'n/a';
  return `${ms.toFixed(1)}ms`;
}

function fmtDeltaMs(cur: number | null, base: number | null): string {
  if (cur == null || base == null) return 'n/a';
  const d = cur - base;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}ms`;
}

function readJson<T>(p: string): T {
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as T;
}

function flattenPwTests(json: PwJson): Array<{ name: string; durationMs: number | null }> {
  const out: Array<{ name: string; durationMs: number | null }> = [];

  const walkSuite = (suite: any, stack: string[]) => {
    const title = typeof suite?.title === 'string' ? suite.title : '';
    const file = typeof suite?.file === 'string' ? suite.file : '';
    const nextStack = [...stack];

    if (title) nextStack.push(title);
    else if (file && !nextStack.includes(file)) nextStack.push(file);

    const specs = Array.isArray(suite?.specs) ? suite.specs : [];
    for (const spec of specs) {
      const specTitle = typeof spec?.title === 'string' ? spec.title : 'test';
      const tests = Array.isArray(spec?.tests) ? spec.tests : [];
      for (const t of tests) {
        const results = Array.isArray(t?.results) ? t.results : [];
        const durations = results.map((r: any) => numOrNull(r?.duration)).filter((d): d is number => d != null);
        const durationMs = durations.length > 0 ? Math.max(...durations) : null;

        // Prefer file + nested describe + test title.
        const fileHint =
          typeof t?.location?.file === 'string'
            ? t.location.file
            : typeof spec?.file === 'string'
              ? spec.file
              : typeof suite?.file === 'string'
                ? suite.file
                : null;
        const parts = [];
        if (fileHint) parts.push(fileHint);
        parts.push(...nextStack.filter(Boolean));
        parts.push(specTitle);
        out.push({ name: parts.join(' > '), durationMs });
      }
    }

    const nested = Array.isArray(suite?.suites) ? suite.suites : [];
    for (const s of nested) walkSuite(s, nextStack);
  };

  for (const s of Array.isArray(json.suites) ? json.suites : []) walkSuite(s, []);
  return out;
}

function usage(): never {
  console.error(
    [
      'Usage:',
      '  tsx scripts/perf/print-test-timings-table.ts \\',
      '    --baseline-unit <path> --current-unit <path> \\',
      '    --baseline-pw <path> --current-pw <path>',
      ''
    ].join('\n')
  );
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args.set(a, argv[i + 1] ?? '');
      i++;
    }
  }
  return {
    baselineUnit: args.get('--baseline-unit'),
    currentUnit: args.get('--current-unit'),
    baselinePw: args.get('--baseline-pw'),
    currentPw: args.get('--current-pw')
  };
}

export async function main() {
  const { baselineUnit, currentUnit, baselinePw, currentPw } = parseArgs(process.argv.slice(2));
  if (!baselineUnit || !currentUnit || !baselinePw || !currentPw) usage();

  const unitBase = readJson<ParsedNodeTestReport>(baselineUnit);
  const unitCur = readJson<ParsedNodeTestReport>(currentUnit);
  const pwBase = readJson<PwJson>(baselinePw);
  const pwCur = readJson<PwJson>(currentPw);

  const rows: Row[] = [];

  const unitBaseMap = new Map(unitBase.testCases.map((t) => [t.fullTitle, t.durationMs]));
  const unitCurMap = new Map(unitCur.testCases.map((t) => [t.fullTitle, t.durationMs]));
  const allUnitNames = new Set([...unitBaseMap.keys(), ...unitCurMap.keys()]);
  for (const name of allUnitNames) {
    rows.push({
      suite: 'unit',
      name,
      baselineMs: unitBaseMap.get(name) ?? null,
      currentMs: unitCurMap.get(name) ?? null
    });
  }

  const pwBaseTests = flattenPwTests(pwBase);
  const pwCurTests = flattenPwTests(pwCur);
  const pwBaseMap = new Map(pwBaseTests.map((t) => [t.name, t.durationMs]));
  const pwCurMap = new Map(pwCurTests.map((t) => [t.name, t.durationMs]));
  const allPwNames = new Set([...pwBaseMap.keys(), ...pwCurMap.keys()]);
  for (const name of allPwNames) {
    rows.push({
      suite: 'pw_installer',
      name,
      baselineMs: pwBaseMap.get(name) ?? null,
      currentMs: pwCurMap.get(name) ?? null
    });
  }

  // Sort: suite, then slowest current, then name.
  rows.sort((a, b) => {
    if (a.suite !== b.suite) return a.suite.localeCompare(b.suite);
    const ad = a.currentMs ?? -1;
    const bd = b.currentMs ?? -1;
    if (ad !== bd) return bd - ad;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  lines.push('| suite | test | baseline | current | delta |');
  lines.push('|---|---|---:|---:|---:|');
  for (const r of rows) {
    lines.push(
      `| ${r.suite} | ${r.name.replace(/\|/g, '\\|')} | ${fmtMs(r.baselineMs)} | ${fmtMs(r.currentMs)} | ${fmtDeltaMs(
        r.currentMs,
        r.baselineMs
      )} |`
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

