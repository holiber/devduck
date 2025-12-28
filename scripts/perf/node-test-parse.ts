#!/usr/bin/env node
/**
 * Parses Node.js test runner (node:test) console output into structured timings.
 *
 * This repo's current runner prints a hierarchical report with:
 * - suite starts: "▶ <suite>"
 * - passing tests: "✔ <test> (<ms>ms)"
 * - skipped tests: "﹣ <test> (<ms>ms) # SKIP"
 * - suite summaries: "✔ <suite> (<ms>ms)" (same indent as the suite start)
 *
 * We reconstruct a suite stack from indentation and emit leaf test cases with a stable `fullTitle`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Status = 'passed' | 'failed' | 'skipped';

export type ParsedTestCase = {
  fullTitle: string;
  title: string;
  suitePath: string[];
  status: Status;
  durationMs: number;
};

export type ParsedNodeTestReport = {
  meta: {
    inputFile: string;
  };
  totals: {
    /** From "ℹ duration_ms ..." line if present. */
    durationMsReported?: number;
    tests?: number;
    suites?: number;
    pass?: number;
    fail?: number;
    skipped?: number;
  };
  testCases: ParsedTestCase[];
};

type SuiteFrame = { title: string; indent: number };

const SUITE_START_RE = /^(\s*)▶\s+(.*)$/u;
const RESULT_RE = /^(\s*)([✔✖﹣])\s+(.*?)\s+\(([\d.]+)ms\)(.*)$/u;

function symbolToStatus(symbol: string): Status {
  switch (symbol) {
    case '✔':
      return 'passed';
    case '✖':
      return 'failed';
    case '﹣':
      return 'skipped';
    default:
      return 'failed';
  }
}

function buildFullTitle(suitePath: string[], title: string): string {
  // Keep a stable separator that will also map well to Playwright's "suite › test" naming.
  return suitePath.length > 0 ? `${suitePath.join(' > ')} > ${title}` : title;
}

export function parseNodeTestOutput(raw: string, inputFile: string): ParsedNodeTestReport {
  const lines = raw.split(/\r?\n/u);

  const suites: SuiteFrame[] = [];
  const testCases: ParsedTestCase[] = [];

  const totals: ParsedNodeTestReport['totals'] = {};

  for (const line of lines) {
    const suiteMatch = line.match(SUITE_START_RE);
    if (suiteMatch) {
      const indent = suiteMatch[1].length;
      const title = suiteMatch[2].trim();

      // If indentation decreases without explicit suite-end lines, unwind defensively.
      while (suites.length > 0 && indent < suites[suites.length - 1].indent) {
        suites.pop();
      }

      suites.push({ title, indent });
      continue;
    }

    const resultMatch = line.match(RESULT_RE);
    if (resultMatch) {
      const indent = resultMatch[1].length;
      const symbol = resultMatch[2];
      const title = resultMatch[3].trim();
      const durationMs = Number.parseFloat(resultMatch[4]);
      const tail = resultMatch[5] ?? '';

      // Suite summary lines repeat the suite title at the same indent as the suite start.
      // Example:
      //   ▶ Some suite
      //     ✔ leaf test (1.23ms)
      //   ✔ Some suite (10.0ms)
      if (suites.length > 0) {
        const top = suites[suites.length - 1];
        if (indent === top.indent && title === top.title) {
          suites.pop();
          continue;
        }
      }

      const suitePath = suites.map((s) => s.title);
      const status: Status =
        tail.includes('# SKIP') || symbol === '﹣' ? 'skipped' : symbolToStatus(symbol);

      testCases.push({
        fullTitle: buildFullTitle(suitePath, title),
        title,
        suitePath,
        status,
        durationMs
      });
      continue;
    }

    // Totals section (present at the end of the runner output)
    const mDuration = line.match(/^\s*ℹ\s+duration_ms\s+([\d.]+)\s*$/u);
    if (mDuration) {
      totals.durationMsReported = Number.parseFloat(mDuration[1]);
      continue;
    }
    const mCount = line.match(/^\s*ℹ\s+(tests|suites|pass|fail|skipped)\s+(\d+)\s*$/u);
    if (mCount) {
      const key = mCount[1] as keyof typeof totals;
      (totals as any)[key] = Number.parseInt(mCount[2], 10);
      continue;
    }
  }

  return {
    meta: { inputFile },
    totals,
    testCases
  };
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
    input: args.get('--input'),
    output: args.get('--output')
  };
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!input) {
    console.error('Usage: tsx scripts/perf/node-test-parse.ts --input <raw.txt> [--output <out.json>]');
    process.exit(2);
  }

  const raw = await readFile(input, 'utf8');
  const parsed = parseNodeTestOutput(raw, path.resolve(input));
  const json = JSON.stringify(parsed, null, 2) + '\n';

  if (output) {
    await writeFile(output, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

