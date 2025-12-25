import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureDirSync } from '../fs-utils.js';

export class PlaywrightService {
  constructor(
    private readonly opts: {
      logsDir: string;
    }
  ) {}

  private async runNpx(args: string[], logBaseName: string, env: Record<string, string | undefined>): Promise<{ exitCode: number; stdoutLogPath: string; stderrLogPath: string }> {
    ensureDirSync(this.opts.logsDir);
    const stdoutLogPath = path.join(this.opts.logsDir, `${logBaseName}.out.log`);
    const stderrLogPath = path.join(this.opts.logsDir, `${logBaseName}.err.log`);
    const out = fs.createWriteStream(stdoutLogPath, { flags: 'a' });
    const err = fs.createWriteStream(stderrLogPath, { flags: 'a' });

    const child = spawn('npx', args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.pipe(out);
    child.stderr?.pipe(err);

    const exitCode: number = await new Promise(resolve => {
      child.on('exit', code => resolve(code ?? 1));
    });

    return { exitCode, stdoutLogPath, stderrLogPath };
  }

  private async ensureChromiumInstalled(): Promise<void> {
    const res = await this.runNpx(['playwright', 'install', 'chromium'], 'playwright-install', {
      CI: '1',
      PW_TEST_HTML_REPORT_OPEN: 'never'
    });
    if (res.exitCode !== 0) {
      throw new Error(`playwright install chromium failed (exit ${res.exitCode}). See ${res.stderrLogPath}`);
    }
  }

  async runSmokecheck(params: {
    testFile: string;
    baseURL: string;
    browserConsoleLogPath: string;
    configFile?: string;
  }): Promise<{ ok: boolean; exitCode: number; stdoutLogPath: string; stderrLogPath: string }> {
    ensureDirSync(path.dirname(params.browserConsoleLogPath));
    const args = ['playwright', 'test', params.testFile];
    if (params.configFile) args.push('--config', params.configFile);

    const env = {
      CI: '1',
      BASE_URL: params.baseURL,
      BROWSER_CONSOLE_LOG_PATH: params.browserConsoleLogPath,
      PW_TEST_HTML_REPORT_OPEN: 'never'
    };

    let first = await this.runNpx(args, 'playwright', env);
    if (first.exitCode === 0) {
      return { ok: true, exitCode: 0, stdoutLogPath: first.stdoutLogPath, stderrLogPath: first.stderrLogPath };
    }

    // If browsers are missing, install Chromium and retry once.
    let combined = '';
    try {
      combined += fs.readFileSync(first.stderrLogPath, 'utf8');
    } catch {
      // ignore
    }
    try {
      combined += '\n' + fs.readFileSync(first.stdoutLogPath, 'utf8');
    } catch {
      // ignore
    }
    const looksLikeMissingBrowser =
      /Executable doesn't exist/i.test(combined) ||
      /download new browsers/i.test(combined) ||
      /npx playwright install/i.test(combined);

    if (looksLikeMissingBrowser) {
      await this.ensureChromiumInstalled();
      const second = await this.runNpx(args, 'playwright', env);
      return {
        ok: second.exitCode === 0,
        exitCode: second.exitCode,
        stdoutLogPath: second.stdoutLogPath,
        stderrLogPath: second.stderrLogPath
      };
    }

    return {
      ok: false,
      exitCode: first.exitCode,
      stdoutLogPath: first.stdoutLogPath,
      stderrLogPath: first.stderrLogPath
    };
  }
}

