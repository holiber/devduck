import path from 'path';

export type DevduckServicePaths = {
  rootDir: string;
  logsDir: string;
  ipcDir: string;
  socketPath: string;
  sessionPath: string;
  lockPath: string;
};

export function getDevduckServicePaths(cwd: string = process.cwd()): DevduckServicePaths {
  const rootDir = path.join(cwd, '.cache', 'devduck-service');
  const logsDir = path.join(rootDir, 'logs');
  const ipcDir = path.join(rootDir, 'ipc');
  return {
    rootDir,
    logsDir,
    ipcDir,
    socketPath: path.join(ipcDir, 'devduck.sock'),
    sessionPath: path.join(rootDir, 'session.json'),
    lockPath: path.join(rootDir, 'service.lock')
  };
}

