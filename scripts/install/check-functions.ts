/**
 * Type definitions for check functions
 * 
 * These types are used to pass check functions to processCheck
 */

import type { CheckItem, CheckResult } from './types.js';

export type IsHttpRequestFunction = (test: string | undefined) => boolean;
export type CheckCommandFunction = (item: CheckItem, context: string | null, skipInstall?: boolean) => Promise<CheckResult>;
export type CheckHttpAccessFunction = (item: CheckItem, context: string | null) => Promise<CheckResult>;
export type ReplaceVariablesFunction = (obj: unknown, env: Record<string, string>) => unknown;

