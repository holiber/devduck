import { replaceVariables, replaceVariablesInObject } from '../lib/config.js';
import type { InstallerPrinter, InstallerSymbols } from './installer-utils.js';

export function createVariableReplacer(params: {
  log: (message: string) => void;
  print: InstallerPrinter;
  symbols: InstallerSymbols;
}): {
  replaceVariablesWithLog: (str: string, env: Record<string, string>) => string;
  replaceVariablesInObjectWithLog: (obj: unknown, env: Record<string, string>) => unknown;
} {
  const { log, print, symbols } = params;
  return {
    replaceVariablesWithLog: (str, env) => replaceVariables(str, env, log, print, symbols),
    replaceVariablesInObjectWithLog: (obj, env) => replaceVariablesInObject(obj, env, log, print, symbols)
  };
}


