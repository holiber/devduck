/**
 * Type definitions for check processing
 */

export interface CheckItem {
  name: string;
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

