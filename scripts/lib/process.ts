import { execa, execaSync, type ExecaChildProcess, type Options, type SyncOptions } from 'execa';

export function execCmdSync(file: string, args: string[] = [], options: SyncOptions<string> = {}) {
  return execaSync(file, args, { reject: false, ...options });
}

export function execShellSync(command: string, options: SyncOptions<string> = {}) {
  return execaSync(command, { reject: false, shell: true, ...options });
}

export function execCmd(file: string, args: string[] = [], options: Options<string> = {}) {
  return execa(file, args, { reject: false, ...options });
}

export function execShell(command: string, options: Options<string> = {}) {
  return execa(command, { reject: false, shell: true, ...options });
}

export function startProcess(
  file: string,
  args: string[] = [],
  options: Options<string> = {}
): ExecaChildProcess<string> {
  return execa(file, args, { reject: false, ...options });
}

