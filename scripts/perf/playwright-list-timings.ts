export type PlaywrightListTiming = {
  id: string;
  durationMs: number;
};

function toMs(value: number, unit: string): number {
  if (unit === 'ms') return value;
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60_000;
  return value;
}

/**
 * Parse Playwright "list" reporter output lines like:
 *   ✓  12 tests/foo.spec.ts:1:1 › suite › test title (123ms)
 */
export function parsePlaywrightListTimings(text: string): PlaywrightListTiming[] {
  const out: PlaywrightListTiming[] = [];
  for (const line of text.split(/\r?\n/)) {
    // The reporter uses unicode checkmarks; keep it permissive.
    const m = /^\s*[✓✘-]\s+\d+\s+(.+)\s+\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/.exec(line);
    if (!m) continue;
    const id = (m[1] ?? '').trim();
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    out.push({ id, durationMs: toMs(value, m[3] ?? 'ms') });
  }
  return out;
}

