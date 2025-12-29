import { spawn } from 'child_process';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureDirSync } from '../fs-utils.js';
import { isPidAlive } from '../pids.js';
import { loadSession, saveSession, type ProcessRecord, type ProcessSpec } from '../session.js';

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export type ProcessStatus = ProcessRecord & { running: boolean };

export class ProcessManager {
  constructor(
    private readonly opts: {
      sessionPath: string;
      logsDir: string;
    }
  ) {}

  private listDescendantPids(rootPid: number): number[] {
    try {
      // Works on macOS/Linux. Output format: "<pid> <ppid>\n"
      const res = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
      if (res.status !== 0 || !res.stdout) return [];
      const childrenByParent = new Map<number, number[]>();
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const pid = Number(parts[0]);
        const ppid = Number(parts[1]);
        if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
        const arr = childrenByParent.get(ppid) ?? [];
        arr.push(pid);
        childrenByParent.set(ppid, arr);
      }
      const out: number[] = [];
      const queue: number[] = [...(childrenByParent.get(rootPid) ?? [])];
      while (queue.length) {
        const pid = queue.shift()!;
        out.push(pid);
        const kids = childrenByParent.get(pid);
        if (kids) queue.push(...kids);
      }
      return out;
    } catch {
      return [];
    }
  }

  private getProcessGroupId(pid: number): number | null {
    try {
      const res = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
      if (res.status !== 0 || !res.stdout) return null;
      const pgid = Number(res.stdout.trim().split(/\s+/)[0]);
      return Number.isFinite(pgid) && pgid > 0 ? pgid : null;
    } catch {
      return null;
    }
  }

  private listPidsInProcessGroup(pgid: number): number[] {
    try {
      const res = spawnSync('ps', ['-eo', 'pid=,pgid='], { encoding: 'utf8' });
      if (res.status !== 0 || !res.stdout) return [];
      const out: number[] = [];
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const pid = Number(parts[0]);
        const g = Number(parts[1]);
        if (!Number.isFinite(pid) || !Number.isFinite(g)) continue;
        if (g === pgid) out.push(pid);
      }
      return out;
    } catch {
      return [];
    }
  }

  start(spec: ProcessSpec): ProcessRecord {
    const session = loadSession(this.opts.sessionPath);
    const existing = session.processes.find(p => p.name === spec.name);
    if (existing && isPidAlive(existing.pid)) {
      return existing;
    }

    ensureDirSync(this.opts.logsDir);
    const base = safeName(spec.name);
    const outLogPath = path.join(this.opts.logsDir, `${base}.out.log`);
    const errLogPath = path.join(this.opts.logsDir, `${base}.err.log`);

    const out = fs.createWriteStream(outLogPath, { flags: 'a' });
    const err = fs.createWriteStream(errLogPath, { flags: 'a' });

    const child = spawn(spec.command, spec.args ?? [], {
      cwd: spec.cwd ?? process.cwd(),
      env: { ...process.env, ...(spec.env ?? {}) },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (!child.pid) {
      throw new Error(`Failed to spawn process: ${spec.name}`);
    }

    child.stdout?.pipe(out);
    child.stderr?.pipe(err);
    child.unref();

    const pgid = this.getProcessGroupId(child.pid) ?? child.pid;
    const record: ProcessRecord = {
      name: spec.name,
      pid: child.pid,
      pgid,
      startedAt: new Date().toISOString(),
      command: spec.command,
      args: spec.args ?? [],
      cwd: spec.cwd,
      outLogPath,
      errLogPath
    };

    const next = {
      ...session,
      processes: [...session.processes.filter(p => p.name !== spec.name), record]
    };
    saveSession(this.opts.sessionPath, next);
    return record;
  }

  async stop(name: string, opts?: { timeoutMs?: number }): Promise<{ stopped: boolean }> {
    const timeoutMs = opts?.timeoutMs ?? 2_000;
    const session = loadSession(this.opts.sessionPath);
    const record = session.processes.find(p => p.name === name);
    if (!record) return { stopped: true };

    const pid = record.pid;
    const descendants = this.listDescendantPids(pid);
    if (isPidAlive(pid)) {
      const pgid = record.pgid ?? this.getProcessGroupId(pid) ?? pid;
      try {
        // Kill the whole process group (requires detached spawn).
        process.kill(-pgid, 'SIGTERM');
      } catch {
        // Fallback to killing the single pid if group kill isn't possible.
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // ignore
        }
      }
      for (const childPid of descendants) {
        try {
          process.kill(childPid, 'SIGTERM');
        } catch {
          // ignore
        }
      }

      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const groupNow = this.listPidsInProcessGroup(pgid);
        const stillAlive =
          (isPidAlive(pid) ? [pid] : []).concat(descendants.filter(isPidAlive)).concat(groupNow.filter(isPidAlive));
        if (stillAlive.length === 0) break;
        await new Promise<void>(r => setTimeout(r, 50));
      }

      const remaining = this.listPidsInProcessGroup(pgid).filter(isPidAlive);
      if (remaining.length > 0) {
        // Escalate to SIGKILL for stubborn processes (Node can keep running on SIGTERM).
        try {
          process.kill(-pgid, 'SIGKILL');
        } catch {
          // ignore
        }
        for (const rp of remaining) {
          try {
            process.kill(rp, 'SIGKILL');
          } catch {
            // ignore
          }
        }
        // Also best-effort kill known descendants that might have escaped the group.
        for (const childPid of descendants) {
          try {
            process.kill(childPid, 'SIGKILL');
          } catch {
            // ignore
          }
        }
        await new Promise<void>(r => setTimeout(r, 100));
      }
    }

    const next = { ...session, processes: session.processes.filter(p => p.name !== name) };
    saveSession(this.opts.sessionPath, next);
    return { stopped: true };
  }

  status(): { processes: ProcessStatus[] } {
    const session = loadSession(this.opts.sessionPath);
    return {
      processes: session.processes.map(p => ({ ...p, running: isPidAlive(p.pid) }))
    };
  }

  readSession() {
    return loadSession(this.opts.sessionPath);
  }

  setBaseURL(baseURL: string): void {
    const session = loadSession(this.opts.sessionPath);
    saveSession(this.opts.sessionPath, { ...session, baseURL });
  }
}

