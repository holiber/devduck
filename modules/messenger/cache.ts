import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { findWorkspaceRoot } from '../../scripts/lib/workspace-root.js';

function safeMkdir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function cacheBaseDir(cwd: string): string {
  const root = findWorkspaceRoot(cwd);
  if (root) return path.join(root, '.cache', 'devduck');
  // Fallback: avoid writing outside current FS permissions.
  return path.join(os.tmpdir(), 'devduck-cache');
}

export function getMessengerCacheDir(opts: { providerName: string; cwd?: string }): string {
  const cwd = opts.cwd || process.cwd();
  const base = cacheBaseDir(cwd);
  const dir = path.join(base, 'messenger', String(opts.providerName || 'unknown-provider'));
  safeMkdir(dir);
  return dir;
}

type JsonCacheEnvelope<T> = {
  cachedAt: string; // ISO
  ttlMs: number;
  value: T;
};

export async function getOrSetJsonCache<T>(opts: {
  dir: string;
  key: string;
  ttlMs: number;
  compute: () => Promise<T>;
}): Promise<T> {
  const filename = `${sha256Hex(opts.key)}.json`;
  const filePath = path.join(opts.dir, filename);

  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as JsonCacheEnvelope<T>;
      const cachedAt = Date.parse(parsed.cachedAt);
      const ageMs = Number.isFinite(cachedAt) ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
      if (ageMs >= 0 && ageMs <= parsed.ttlMs) {
        return parsed.value;
      }
    }
  } catch {
    // ignore cache read errors
  }

  const value = await opts.compute();
  const env: JsonCacheEnvelope<T> = { cachedAt: new Date().toISOString(), ttlMs: opts.ttlMs, value };

  try {
    safeMkdir(opts.dir);
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(env, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, filePath);
  } catch {
    // ignore cache write errors
  }

  return value;
}

type BufferMeta = { cachedAt: string; ttlMs: number; sizeBytes?: number; fileName: string };

export async function getOrSetBufferCache(opts: {
  dir: string;
  key: string;
  ttlMs: number;
  compute: () => Promise<Buffer>;
}): Promise<Buffer> {
  const base = sha256Hex(opts.key);
  const binName = `${base}.bin`;
  const metaName = `${base}.meta.json`;
  const binPath = path.join(opts.dir, binName);
  const metaPath = path.join(opts.dir, metaName);

  try {
    if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
      const metaRaw = fs.readFileSync(metaPath, 'utf8');
      const meta = JSON.parse(metaRaw) as BufferMeta;
      const cachedAt = Date.parse(meta.cachedAt);
      const ageMs = Number.isFinite(cachedAt) ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
      if (ageMs >= 0 && ageMs <= meta.ttlMs) {
        return fs.readFileSync(binPath);
      }
    }
  } catch {
    // ignore cache read errors
  }

  const buf = await opts.compute();
  const meta: BufferMeta = {
    cachedAt: new Date().toISOString(),
    ttlMs: opts.ttlMs,
    sizeBytes: buf?.byteLength,
    fileName: binName
  };

  try {
    safeMkdir(opts.dir);
    const tmpBin = `${binPath}.tmp-${process.pid}-${Date.now()}`;
    const tmpMeta = `${metaPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpBin, buf);
    fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpBin, binPath);
    fs.renameSync(tmpMeta, metaPath);
  } catch {
    // ignore cache write errors
  }

  return buf;
}

