import { spawnSync } from 'child_process';

function isZombieProcess(pid: number): boolean {
  try {
    const res = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    if (res.status !== 0 || !res.stdout) return false;
    const stat = res.stdout.trim();
    // `ps` stat contains 'Z' for zombie (e.g. "Z", "Z+", "Zs").
    return stat.includes('Z');
  } catch {
    return false;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return !isZombieProcess(pid);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') return false;
    // EPERM means it exists but we don't have permission.
    if (err.code === 'EPERM') return true;
    return false;
  }
}

export async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await new Promise<void>(r => setTimeout(r, 50));
  }
  return !isPidAlive(pid);
}

