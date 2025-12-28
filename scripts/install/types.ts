/**
 * Type definitions for check processing
 */

export interface CheckItem {
  name?: string;
  description?: string;
  test?: string;
  install?: string;
  mcpSettings?: Record<string, unknown>;
  _execCwd?: string;
  [key: string]: unknown;
}

export interface CheckResult {
  name: string;
  passed: boolean | null;
  version?: string | null;
  note?: string;
  filePath?: string;
  tier?: string;
  skipped?: boolean;
  statusCode?: number;
  error?: string;
  description?: string;
}

export function getCheckDisplayName(check: CheckItem): string {
  const anyCheck = check as { var?: unknown; id?: unknown; type?: unknown };
  const name =
    (typeof check.name === 'string' && check.name.trim()) ||
    (typeof anyCheck.var === 'string' && anyCheck.var.trim()) ||
    (typeof anyCheck.id === 'string' && anyCheck.id.trim()) ||
    (typeof anyCheck.type === 'string' && anyCheck.type.trim()) ||
    '<unknown-check>';
  return name;
}

