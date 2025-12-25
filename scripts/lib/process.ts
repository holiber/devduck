import {
  execa,
  execaSync,
  type ExecaChildProcess,
  type Options as ExecaOptions,
  type SyncOptions as ExecaSyncOptions
} from 'execa';

export type ExecOptions = ExecaOptions<string>;
export type ExecSyncOptions = ExecaSyncOptions<string>;

export type ExecResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function execCmdSync(
  file: string,
  args: string[] = [],
  options: ExecSyncOptions = {}
): ExecResult {
  const res = execaSync(file, args, {
    encoding: 'utf8',
    reject: false,
    ...options
  });

  return {
    ok: (res.exitCode ?? 1) === 0,
    exitCode: res.exitCode ?? 1,
    stdout: normalizeText(res.stdout),
    stderr: normalizeText(res.stderr)
  };
}

export function execShellSync(command: string, options: ExecSyncOptions = {}): ExecResult {
  const res = execaSync(command, {
    encoding: 'utf8',
    reject: false,
    shell: true,
    ...options
  });

  return {
    ok: (res.exitCode ?? 1) === 0,
    exitCode: res.exitCode ?? 1,
    stdout: normalizeText(res.stdout),
    stderr: normalizeText(res.stderr)
  };
}

export async function execCmd(
  file: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const res = await execa(file, args, {
    encoding: 'utf8',
    reject: false,
    ...options
  });

  return {
    ok: (res.exitCode ?? 1) === 0,
    exitCode: res.exitCode ?? 1,
    stdout: normalizeText(res.stdout),
    stderr: normalizeText(res.stderr)
  };
}

export async function execShell(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const res = await execa(command, {
    encoding: 'utf8',
    reject: false,
    shell: true,
    ...options
  });

  return {
    ok: (res.exitCode ?? 1) === 0,
    exitCode: res.exitCode ?? 1,
    stdout: normalizeText(res.stdout),
    stderr: normalizeText(res.stderr)
  };
}

/**
 * Start a long-running process.
 *
 * This returns Execa's subprocess object (which is also a promise),
 * so callers can stream stdin/stdout and also await completion if needed.
 */
export function startProcess(
  file: string,
  args: string[] = [],
  options: ExecOptions = {}
): ExecaChildProcess<string> {
  return execa(file, args, {
    encoding: 'utf8',
    reject: false,
    ...options
  });
}

