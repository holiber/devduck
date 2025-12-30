import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { defineProvider } from '../../../../src/lib/define-provider.js';
import { INSTALLER_PROVIDER_PROTOCOL_VERSION } from '../../schemas/contract.js';

function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  const home = process.env.HOME || '';
  return p.replace(/^~(?=\/|$)/, home);
}

function isLikelyGitUrl(src: string): boolean {
  return src.startsWith('git@') || /^https?:\/\//.test(src);
}

function looksLikeSchemeUrl(src: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(src);
}

function resolveSrcToPath(src: string): string | null {
  const s = String(src || '').trim();
  if (!s) return null;

  if (s.startsWith('file://')) {
    try {
      return fileURLToPath(new URL(s));
    } catch {
      return null;
    }
  }

  if (looksLikeSchemeUrl(s)) {
    // Not a file:// URL
    return null;
  }

  return path.resolve(expandHome(s));
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        // Skip common large dirs
        if (e.name === 'node_modules') continue;
        stack.push(abs);
        continue;
      }
      if (e.isFile()) {
        out.push(abs);
      }
    }
  }

  return out;
}

function copyDirRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules') {
      continue;
    }
    const srcAbs = path.join(srcDir, e.name);
    const destAbs = path.join(destDir, e.name);
    if (e.isDirectory()) {
      copyDirRecursive(srcAbs, destAbs);
      continue;
    }
    if (e.isFile()) {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      // Preserve mtime as a cheap “same content” heuristic
      const st = fs.statSync(srcAbs);
      fs.utimesSync(destAbs, st.atime, st.mtime);
    }
  }
}

function computeDirtyFiles(srcDir: string, destDir: string): string[] {
  const srcFiles = listFilesRecursive(srcDir);
  const destFiles = listFilesRecursive(destDir);

  const srcRel = new Map<string, string>();
  for (const f of srcFiles) srcRel.set(path.relative(srcDir, f), f);

  const destRel = new Map<string, string>();
  for (const f of destFiles) destRel.set(path.relative(destDir, f), f);

  const dirty: string[] = [];
  const allRels = new Set<string>([...srcRel.keys(), ...destRel.keys()]);

  for (const rel of Array.from(allRels).sort()) {
    const sAbs = srcRel.get(rel);
    const dAbs = destRel.get(rel);
    if (!sAbs || !dAbs) {
      dirty.push(rel);
      continue;
    }
    try {
      const ss = fs.statSync(sAbs);
      const ds = fs.statSync(dAbs);
      if (ss.size !== ds.size) {
        dirty.push(rel);
        continue;
      }
      // Millisecond precision is fine for local FS
      if (Math.floor(ss.mtimeMs) !== Math.floor(ds.mtimeMs)) {
        dirty.push(rel);
        continue;
      }
    } catch {
      dirty.push(rel);
    }
  }

  return dirty;
}

const tools = {
  async isValidSrc(input: { src: string }) {
    const src = String(input?.src || '').trim();
    if (!src) return false;
    if (isLikelyGitUrl(src)) return false;
    const resolved = resolveSrcToPath(src);
    if (!resolved) return false;
    try {
      return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    } catch {
      return false;
    }
  },

  async install(input: { src: string; dest: string; force?: boolean }) {
    const src = String(input?.src || '').trim();
    const dest = path.resolve(String(input?.dest || '').trim());
    const force = !!input?.force;

    const srcDir = resolveSrcToPath(src);
    if (!srcDir) {
      throw new Error(`installer-fs-provider: invalid src: ${src}`);
    }
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
      throw new Error(`installer-fs-provider: src is not a directory: ${srcDir}`);
    }

    if (fs.existsSync(dest)) {
      const st = fs.statSync(dest);
      if (!st.isDirectory()) {
        throw new Error(`installer-fs-provider: dest exists and is not a directory: ${dest}`);
      }
      const dirty = computeDirtyFiles(srcDir, dest);
      if (dirty.length > 0) {
        if (!force) {
          throw new Error(
            `installer-fs-provider: destination already exists and differs from source.\nChanged files (${dirty.length}):\n` +
              dirty.map((p) => `- ${p}`).join('\n')
          );
        }
        fs.rmSync(dest, { recursive: true, force: true });
      } else {
        // Already installed and clean
        return;
      }
    }

    copyDirRecursive(srcDir, dest);
  }
};

export default defineProvider({
  type: 'installer',
  name: 'installer-fs-provider',
  version: '0.1.0',
  description: 'Install entities from local filesystem (copy folder)',
  protocolVersion: INSTALLER_PROVIDER_PROTOCOL_VERSION,
  tools,
  auth: { type: 'none', requiredTokens: [] },
  capabilities: ['fs.copy']
});

