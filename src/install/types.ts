/**
 * Type definitions for check processing
 */

export interface CheckItem {
  name?: string;
  description?: string;
  /**
   * Shell condition evaluated before running the check.
   * If it exits with non-zero, the check is skipped.
   */
  when?: string;
  test?: string;
  install?: string;
  /**
   * Check requirement level.
   * - required (default): failing check stops installation
   * - recomended: failing check does not stop installation (warning)
   * - optional: installer does not attempt to install, check is skipped
   *
   * Note: "recomended" is intentionally misspelled for backward compatibility with configs.
   */
  requirement?: 'required' | 'recomended' | 'recommended' | 'optional' | string;

  /**
   * Deprecated: replaced by `requirement`.
   * If true, treated as `requirement: "optional"`.
   */
  optional?: boolean;
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
  requirement?: string;
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

export type CheckRequirement = 'required' | 'recomended' | 'optional';

export function getCheckRequirement(check: CheckItem): CheckRequirement {
  // Back-compat: historically checks used `optional: true`.
  if (check.optional === true) return 'optional';

  const raw = typeof check.requirement === 'string' ? check.requirement.trim().toLowerCase() : '';
  if (raw === 'optional') return 'optional';
  // Accept both spellings but normalize to the config spelling.
  if (raw === 'recommended' || raw === 'recomended') return 'recomended';
  // Default behavior: required.
  return 'required';
}

