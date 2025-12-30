import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

import { defineProvider } from '../../../../src/lib/define-provider.js';
import { INSTALLER_PROVIDER_PROTOCOL_VERSION } from '../../../installer/schemas/contract.js';

function isGitLikeSrc(src: string): boolean {
  const s = String(src || '').trim();
  if (!s) return false;
  if (s.startsWith('git@')) return true;
  if (/^https?:\/\//.test(s)) return true;
  if (s.includes('github.com/') || s.includes('gitlab.com/')) return true;
  // Local path to a git repo (used by installer tests / local development)
  try {
    const p = path.resolve(s);
    if (fs.existsSync(path.join(p, '.git'))) return true;
  } catch {
    // ignore
  }
  return false;
}

function normalizeGitUrl(src: string): string {
  const s = String(src || '').trim();
  if (!s) return s;
  // Support "github.com/user/repo" shorthand
  if (s.includes('github.com/') && !s.startsWith('git@') && !s.startsWith('http://') && !s.startsWith('https://')) {
    return `https://${s.replace(/^github\.com\//, 'github.com/').replace(/\.git$/, '')}.git`;
  }
  // Ensure https URLs end with .git for consistency (optional)
  if (s.startsWith('https://') && (s.includes('github.com') || s.includes('gitlab.com')) && !s.endsWith('.git')) {
    return `${s}.git`;
  }
  if (s.startsWith('http://')) {
    const https = s.replace(/^http:\/\//, 'https://');
    if ((https.includes('github.com') || https.includes('gitlab.com')) && !https.endsWith('.git')) {
      return `${https}.git`;
    }
    return https;
  }
  return s;
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

function gitStatusPorcelain(dir: string): string[] {
  const out = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  if (!out) return [];
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function gitRemoteOrigin(dir: string): string {
  try {
    return execSync('git remote get-url origin', { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

function runGitClone(url: string, dest: string): void {
  const res = spawnSync('git', ['clone', url, dest], { encoding: 'utf8', stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`installer-git-provider: failed to clone: ${url}`);
  }
}

function runGitPull(dest: string): void {
  const res = spawnSync('git', ['pull', '--ff-only'], { cwd: dest, encoding: 'utf8', stdio: 'inherit' });
  if (res.status !== 0) {
    // Keep permissive: if pull fails, keep existing checkout
    throw new Error(`installer-git-provider: failed to pull in ${dest}`);
  }
}

const tools = {
  async isValidSrc(input: { src: string }) {
    const src = String(input?.src || '').trim();
    return isGitLikeSrc(src);
  },

  async install(input: { src: string; dest: string; force?: boolean }) {
    const src = normalizeGitUrl(String(input?.src || '').trim());
    const dest = path.resolve(String(input?.dest || '').trim());
    const force = !!input?.force;

    if (!src) {
      throw new Error('installer-git-provider: src is required');
    }

    if (fs.existsSync(dest)) {
      const st = fs.statSync(dest);
      if (!st.isDirectory()) {
        throw new Error(`installer-git-provider: dest exists and is not a directory: ${dest}`);
      }
      if (!isGitRepo(dest)) {
        if (!force) {
          throw new Error(`installer-git-provider: dest exists but is not a git repo: ${dest}`);
        }
        fs.rmSync(dest, { recursive: true, force: true });
        runGitClone(src, dest);
        return;
      }

      const dirty = gitStatusPorcelain(dest);
      if (dirty.length > 0) {
        if (!force) {
          throw new Error(
            `installer-git-provider: destination has uncommitted changes.\nChanged files (${dirty.length}):\n` +
              dirty.map((l) => `- ${l}`).join('\n')
          );
        }
        // Force: discard changes and continue
        spawnSync('git', ['reset', '--hard'], { cwd: dest, encoding: 'utf8', stdio: 'inherit' });
        spawnSync('git', ['clean', '-fd'], { cwd: dest, encoding: 'utf8', stdio: 'inherit' });
      }

      const origin = gitRemoteOrigin(dest);
      if (origin && origin !== src && !force) {
        throw new Error(`installer-git-provider: dest origin differs.\nExpected: ${src}\nActual:   ${origin}`);
      }
      if (origin && origin !== src && force) {
        fs.rmSync(dest, { recursive: true, force: true });
        runGitClone(src, dest);
        return;
      }

      // Installed and clean -> update
      runGitPull(dest);
      return;
    }

    runGitClone(src, dest);
  }
};

export default defineProvider({
  type: 'installer',
  name: 'installer-git-provider',
  version: '0.1.0',
  description: 'Install git repositories into destination directory (git clone)',
  protocolVersion: INSTALLER_PROVIDER_PROTOCOL_VERSION,
  tools,
  auth: { type: 'none', requiredTokens: [] },
  capabilities: ['git.clone', 'git.pull']
});

