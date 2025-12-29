import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Pino-compatible (levels-only) surface:
// - logger.info('msg')
// - logger.info({ key: 'value' }, 'msg')
export type InstallLogger = {
  debug: (objOrMsg?: Record<string, unknown> | string, msg?: string) => void;
  info: (objOrMsg?: Record<string, unknown> | string, msg?: string) => void;
  warn: (objOrMsg?: Record<string, unknown> | string, msg?: string) => void;
  error: (objOrMsg?: Record<string, unknown> | string, msg?: string) => void;
};

function normalizeArgs(
  objOrMsg?: Record<string, unknown> | string,
  msg?: string
): { obj: Record<string, unknown>; msg: string } {
  if (typeof objOrMsg === 'string') {
    return { obj: {}, msg: objOrMsg };
  }
  return { obj: objOrMsg ?? {}, msg: msg ?? '' };
}

function levelToNumber(level: LogLevel): number {
  // Align with pino numeric levels.
  switch (level) {
    case 'debug':
      return 20;
    case 'info':
      return 30;
    case 'warn':
      return 40;
    case 'error':
      return 50;
  }
}

export function createInstallLogger(
  workspaceRoot: string,
  opts: { filePath?: string } = {}
): InstallLogger {
  const cacheDir = path.join(workspaceRoot, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const filePath = opts.filePath ?? path.join(cacheDir, 'install.log');

  const write = (level: LogLevel, objOrMsg?: Record<string, unknown> | string, msg?: string): void => {
    const { obj, msg: normalizedMsg } = normalizeArgs(objOrMsg, msg);
    const line = {
      level: levelToNumber(level),
      time: Date.now(),
      msg: normalizedMsg,
      ...obj
    };
    fs.appendFileSync(filePath, JSON.stringify(line) + '\n', 'utf8');
  };

  return {
    debug: (objOrMsg, msg) => write('debug', objOrMsg, msg),
    info: (objOrMsg, msg) => write('info', objOrMsg, msg),
    warn: (objOrMsg, msg) => write('warn', objOrMsg, msg),
    error: (objOrMsg, msg) => write('error', objOrMsg, msg)
  };
}


