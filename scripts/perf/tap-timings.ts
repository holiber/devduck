import path from 'node:path';

export type TapTestTiming = {
  /** Best-effort unique id: `<file>::<fullName>` */
  id: string;
  /** Top-level suite/subtest name (used when file path is not present in TAP). */
  rootSuite: string;
  file?: string;
  /** Full hierarchical test name (excluding file subtest when detected). */
  fullName: string;
  durationMs: number;
};

type StackFrame = { depth: number; name: string };

function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isProbablyTestFileSubtest(name: string): boolean {
  // Node's --test TAP output often nests: "Subtest: <file>"
  return name.endsWith('.test.ts') || name.endsWith('.spec.ts') || name.includes(`${path.sep}tests${path.sep}`);
}

/**
 * Parse Node.js TAP reporter output and extract per-test duration_ms entries.
 *
 * Notes:
 * - This is a "best effort" parser tuned for Node's `--test-reporter=tap`.
 * - We treat `ok ... - <name>` blocks with a following `duration_ms:` field as a single timing record.
 */
export function parseNodeTapDurations(tapText: string): TapTestTiming[] {
  const lines = tapText.split(/\r?\n/);

  const stack: StackFrame[] = [];
  let lastOkName: { depth: number; name: string } | null = null;

  const out: TapTestTiming[] = [];

  for (const rawLine of lines) {
    const line = rawLine;

    // Example:
    // "# Subtest: Installation Steps"
    // "    # Subtest: Step 1: Check Environment Variables"
    const mSub = /^(\s*)# Subtest:\s*(.+)\s*$/.exec(line);
    if (mSub) {
      const depth = Math.floor((mSub[1]?.length ?? 0) / 4);
      const name = normalizeName(mSub[2] ?? '');

      // Truncate stack to this depth, then push.
      while (stack.length > depth) stack.pop();
      stack.push({ depth, name });

      // A new subtest boundary resets last ok name at this depth.
      lastOkName = null;
      continue;
    }

    // Example:
    // "    ok 2 - Step 2: Download Repos"
    const mOk = /^(\s*)ok\s+\d+\s+-\s+(.+)\s*$/.exec(line);
    if (mOk) {
      const depth = Math.floor((mOk[1]?.length ?? 0) / 4);
      lastOkName = { depth, name: normalizeName(mOk[2] ?? '') };
      continue;
    }

    // Example:
    // "      duration_ms: 29.195615"
    const mDur = /^\s*duration_ms:\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(line);
    if (mDur && lastOkName) {
      const durationMs = Number(mDur[1]);
      if (!Number.isFinite(durationMs)) continue;

      // Compute best-effort file and full test path.
      const stackNames = stack.map(s => s.name);
      const rootSuite = stackNames[0] ?? 'unknown';
      const fileFrameIdx = stackNames.findIndex(isProbablyTestFileSubtest);

      const file =
        fileFrameIdx >= 0
          ? stackNames[fileFrameIdx]
          : rootSuite;

      const nameParts =
        fileFrameIdx >= 0
          ? stackNames.slice(fileFrameIdx + 1)
          : stackNames.slice();

      // Include the ok line name as the leaf (it may duplicate the last Subtest name; keep it for stability).
      const fullName = normalizeName([...nameParts, lastOkName.name].filter(Boolean).join(' › '));
      const id = `${file ?? 'unknown'}::${fullName}`;

      out.push({ id, rootSuite, file, fullName, durationMs });
      continue;
    }
  }

  // Deduplicate exact duplicates (can happen with repeated duration blocks).
  const seen = new Set<string>();
  return out.filter(t => {
    const key = `${t.id}::${t.durationMs}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

