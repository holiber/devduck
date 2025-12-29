import path from 'path';
import os from 'os';
import crypto from 'crypto';

export type DevduckServicePaths = {
  rootDir: string;
  logsDir: string;
  ipcDir: string;
  socketPath: string;
  sessionPath: string;
  lockPath: string;
};

export function getDevduckServicePaths(cwd: string = process.cwd()): DevduckServicePaths {
  const rootDir = path.join(cwd, '.cache', 'barducks-service');
  const logsDir = path.join(rootDir, 'logs');
  const ipcDir = path.join(rootDir, 'ipc');
  const defaultSocketPath = path.join(ipcDir, 'barducks.sock');

  // Unix domain sockets have a strict path length limit on macOS.
  // If the default workspace-based socket path is too long, fall back to a short /tmp-based path.
  const socketPath =
    process.platform === 'darwin' && defaultSocketPath.length >= 100
      ? path.join(
          os.tmpdir(),
          `barducks-${crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12)}.sock`
        )
      : defaultSocketPath;
  return {
    rootDir,
    logsDir,
    ipcDir,
    socketPath,
    sessionPath: path.join(rootDir, 'session.json'),
    lockPath: path.join(rootDir, 'service.lock')
  };
}

