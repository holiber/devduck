import path from 'path';
import { ensureDirSync } from './fs-utils.js';
import type { BarducksServicePaths } from './paths.js';
import { ProcessManager } from './process/ProcessManager.js';
import { PlaywrightService } from './playwright/PlaywrightService.js';

export class BarducksService {
  public readonly processManager: ProcessManager;
  public readonly playwrightService: PlaywrightService;

  constructor(public readonly paths: BarducksServicePaths) {
    ensureDirSync(this.paths.rootDir);
    ensureDirSync(this.paths.logsDir);
    ensureDirSync(this.paths.ipcDir);

    this.processManager = new ProcessManager({
      sessionPath: this.paths.sessionPath,
      logsDir: this.paths.logsDir
    });

    this.playwrightService = new PlaywrightService({
      logsDir: this.paths.logsDir
    });
  }

  get browserConsoleLogPath(): string {
    return path.join(this.paths.logsDir, 'browser-console.log');
  }
}

