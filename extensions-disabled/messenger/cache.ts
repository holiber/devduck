import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { findWorkspaceRoot } from '@barducks/sdk';

export function isMessengerCacheDisabled(): boolean {
  const v = String(process.env.MESSENGER_CACHE_DISABLE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

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
  if (root) return path.join(root, '.cache', 'barducks');
  // Fallback: avoid writing outside current FS permissions.
  return path.join(os.tmpdir(), 'barducks-cache');
}

export function getMessengerCacheDir(opts: { providerName: string; cwd?: string }): string {
  const cwd = opts.cwd || process.cwd();
  const base = cacheBaseDir(cwd);
  const dir = path.join(base, 'messenger', String(opts.providerName || 'unknown-provider'));
  safeMkdir(dir);
  return dir;
}

let lastEphemeralGcAtMs = 0;
function maybeGcEphemeralDir(baseDir: string): void {
  // Best-effort and throttled (avoid doing FS walks too often).
  const now = Date.now();
  if (now - lastEphemeralGcAtMs < 60_000) return;
  lastEphemeralGcAtMs = now;

  const ttlMsRaw = String(process.env.MESSENGER_EPHEMERAL_TTL_MS || '').trim();
  const ttlMs = Math.max(0, Number.isFinite(Number(ttlMsRaw)) ? Math.floor(Number(ttlMsRaw)) : 6 * 60 * 60 * 1000);
  if (ttlMs <= 0) return;

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const p = path.join(baseDir, e.name);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > ttlMs) fs.unlinkSync(p);
      } catch {
        // ignore per-file errors
      }
    }
  } catch {
    // ignore GC errors
  }
}

export function writeTempBufferFile(opts: { providerName: string; key: string; buffer: Buffer }): {
  path: string;
  sizeBytes: number;
  sha256: string;
} {
  const base = path.join(os.tmpdir(), 'barducks-messenger-ephemeral', String(opts.providerName || 'unknown-provider'));
  safeMkdir(base);
  maybeGcEphemeralDir(base);
  const name = `${sha256Hex(`${opts.key}:${Date.now()}:${process.pid}`)}.bin`;
  const filePath = path.join(base, name);
  fs.writeFileSync(filePath, opts.buffer);
  const sha256 = crypto.createHash('sha256').update(opts.buffer).digest('hex');
  return { path: filePath, sizeBytes: opts.buffer.byteLength, sha256 };
}

type JsonCacheEnvelope<T> = {
  cachedAt: string; // ISO
  ttlMs: number;
  value: T;
};

const inflightJson: Map<string, Promise<unknown>> = new Map();
const inflightFile: Map<string, Promise<unknown>> = new Map();

const lastTmpGcByDirMs: Map<string, number> = new Map();
function maybeGcTmpFiles(dir: string): void {
  const now = Date.now();
  const last = lastTmpGcByDirMs.get(dir) || 0;
  if (now - last < 60_000) return;
  lastTmpGcByDirMs.set(dir, now);

  const ttlMsRaw = String(process.env.MESSENGER_CACHE_TMP_TTL_MS || '').trim();
  const ttlMs = Math.max(0, Number.isFinite(Number(ttlMsRaw)) ? Math.floor(Number(ttlMsRaw)) : 30 * 60 * 1000);
  if (ttlMs <= 0) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      // Match our own temp naming: "<target> .tmp-<pid>-<timestamp>" (suffix).
      if (!/\.tmp-\d+-\d+$/.test(e.name)) continue;
      const p = path.join(dir, e.name);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        if (now - st.mtimeMs > ttlMs) fs.unlinkSync(p);
      } catch {
        // ignore per-file errors
      }
    }
  } catch {
    // ignore GC errors
  }
}

export async function getOrSetJsonCache<T>(opts: {
  dir: string;
  key: string;
  ttlMs: number;
  compute: () => Promise<T>;
}): Promise<T> {
  if (isMessengerCacheDisabled()) {
    return await opts.compute();
  }

  maybeGcTmpFiles(opts.dir);

  const inflightKey = `${opts.dir}::json::${opts.key}`;
  const existing = inflightJson.get(inflightKey) as Promise<T> | undefined;
  if (existing) return await existing;

  const p = (async () => {
  const filename = `${sha256Hex(opts.key)}.json`;
  const filePath = path.join(opts.dir, filename);

  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as JsonCacheEnvelope<T>;
      const cachedAt = Date.parse(parsed.cachedAt);
      const ageMs = Number.isFinite(cachedAt) ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
      // Use current TTL (env/config) so changing TTL takes effect immediately.
      if (ageMs >= 0 && ageMs <= Math.max(0, opts.ttlMs)) {
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
  })();

  inflightJson.set(inflightKey, p as Promise<unknown>);
  try {
    return await p;
  } finally {
    inflightJson.delete(inflightKey);
  }
}

type BufferMeta = {
  cachedAt: string;
  ttlMs: number;
  sizeBytes?: number;
  fileName: string;
  sha256?: string;
  mimeType?: string;
  originalFileId?: string;
};

export async function getOrSetFileCache(opts: {
  dir: string;
  key: string;
  ttlMs: number;
  compute: () => Promise<{ buffer: Buffer; mimeType?: string; originalFileId?: string }>;
  /**
   * Provider name, used only when cache is disabled to write an ephemeral file instead of caching.
   */
  providerName?: string;
}): Promise<{
  path: string;
  cached: boolean;
  sizeBytes?: number;
  sha256?: string;
  mimeType?: string;
  originalFileId?: string;
}> {
  if (isMessengerCacheDisabled()) {
    const computed = await opts.compute();
    const tmp = writeTempBufferFile({
      providerName: opts.providerName || 'unknown-provider',
      key: `messenger:file:${opts.key}`,
      buffer: computed.buffer
    });
    return {
      path: tmp.path,
      cached: false,
      sizeBytes: tmp.sizeBytes,
      sha256: tmp.sha256,
      mimeType: computed.mimeType,
      originalFileId: computed.originalFileId
    };
  }

  maybeGcTmpFiles(opts.dir);

  const inflightKey = `${opts.dir}::file::${opts.key}`;
  const existing = inflightFile.get(inflightKey) as
    | Promise<{
        path: string;
        cached: boolean;
        sizeBytes?: number;
        sha256?: string;
        mimeType?: string;
        originalFileId?: string;
      }>
    | undefined;
  if (existing) return await existing;

  const p = (async () => {
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
      if (ageMs >= 0 && ageMs <= Math.max(0, opts.ttlMs)) {
        return {
          path: binPath,
          cached: true,
          sizeBytes: meta.sizeBytes,
          sha256: meta.sha256,
          mimeType: meta.mimeType,
          originalFileId: meta.originalFileId
        };
      }
    }
  } catch {
    // ignore cache read errors
  }

  const computed = await opts.compute();
  const buf = computed.buffer;
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const meta: BufferMeta = {
    cachedAt: new Date().toISOString(),
    ttlMs: opts.ttlMs,
    sizeBytes: buf?.byteLength,
    fileName: binName,
    sha256,
    mimeType: computed.mimeType,
    originalFileId: computed.originalFileId
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

  return {
    path: binPath,
    cached: false,
    sizeBytes: meta.sizeBytes,
    sha256: meta.sha256,
    mimeType: meta.mimeType,
    originalFileId: computed.originalFileId
  };
  })();

  inflightFile.set(inflightKey, p as Promise<unknown>);
  try {
    return await p;
  } finally {
    inflightFile.delete(inflightKey);
  }
}

