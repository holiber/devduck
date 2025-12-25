import path from 'path';
import fs from 'fs';
import { URL } from 'url';
import { execCmdSync } from './process.js';

interface ResolveWorkspaceRootOptions {
  projectRoot?: string;
  findWorkspaceRoot?: (startPath: string) => string | null;
  getGitRoot?: (cwd: string) => string | null;
  getArcadiaRoot?: () => string | null;
  fsExistsSync?: (path: string) => boolean;
}

export function tryParseUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Accept both "scheme://..." and "scheme:/..." (e.g. ark:/path/to/file).
  // URL() requires a scheme; without it we treat the input as a filesystem path.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function getGitRoot(cwd: string): string | null {
  const res = execCmdSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (res.exitCode !== 0) return null;
  const out = (res.stdout || '').trim();
  return out ? out : null;
}

export function getArcadiaRoot(): string | null {
  const res = execCmdSync('arc', ['root'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.exitCode !== 0) return null;
  const out = (res.stdout || '').trim();
  return out ? out : null;
}

export function parseGithubSubpath(url: URL): string | null {
  // Supports:
  // - https://github.com/<org>/<repo>/blob/<ref>/<path>
  // - https://github.com/<org>/<repo>/tree/<ref>/<path>
  // - https://raw.githubusercontent.com/<org>/<repo>/<ref>/<path>
  const host = (url.hostname || '').toLowerCase();
  const parts = (url.pathname || '').split('/').filter(Boolean);

  if (host === 'raw.githubusercontent.com') {
    // /org/repo/ref/path...
    if (parts.length >= 4) return parts.slice(3).join('/');
    return null;
  }

  if (host === 'github.com' || host === 'www.github.com') {
    // /org/repo/blob/ref/path...
    if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'tree')) {
      return parts.slice(4).join('/');
    }
    return null;
  }

  return null;
}

export function parseArkSubpath(url: URL): string {
  // Supported link format (Arcadia):
  // - ark:/<path>
  // The path is treated as relative to `arc root`.
  // Keep it permissive: strip leading slashes; decode percent-encoding.
  const rawPath = url.pathname || '';
  const decoded = decodeURIComponent(rawPath);
  return decoded.replace(/^\/+/, '');
}

export function isLikelyArcadiaUrl(url: URL): boolean {
  return (url.protocol || '').toLowerCase() === 'ark:';
}

export function isLikelyGithubUrl(url: URL): boolean {
  const host = (url.hostname || '').toLowerCase();
  return host === 'github.com' || host === 'www.github.com' || host === 'raw.githubusercontent.com';
}

/**
 * Resolve --workspace-path into a local directory path.
 *
 * Supports:
 * - Regular filesystem paths
 * - GitHub "file links" (mapped to local git checkout root)
 * - Arcadia "file links" (mapped to local arcadia root via `arc root`)
 *
 * @param workspacePathInput - Input workspace path
 * @param opts - Options object
 * @returns absolute path to workspace root
 */
export function resolveWorkspaceRoot(
  workspacePathInput: string,
  opts: ResolveWorkspaceRootOptions = {}
): string {
  const projectRoot = opts.projectRoot || process.cwd();
  const findWorkspaceRoot = opts.findWorkspaceRoot || (() => null);
  const fsExistsSync = opts.fsExistsSync || fs.existsSync;
  const gitRootFn = opts.getGitRoot || getGitRoot;
  const arcRootFn = opts.getArcadiaRoot || getArcadiaRoot;

  const input = typeof workspacePathInput === 'string' ? workspacePathInput.trim() : '';
  if (!input) return path.resolve(projectRoot);

  // file://... -> filesystem path
  const parsedUrl = tryParseUrl(input);
  if (parsedUrl && parsedUrl.protocol === 'file:') {
    const filePath = decodeURIComponent(parsedUrl.pathname || '');
    const start = path.dirname(filePath);
    return path.resolve(findWorkspaceRoot(start) || start);
  }

  if (parsedUrl && isLikelyArcadiaUrl(parsedUrl)) {
    const arcRoot = arcRootFn();
    const fallback = arcRoot ? path.resolve(arcRoot) : path.resolve(projectRoot);
    const subpath = parseArkSubpath(parsedUrl);

    if (arcRoot && subpath) {
      // Some ark: links may include "arcadia/" prefix; normalize it away if present,
      // because `arc root` already points at the Arcadia checkout root.
      const normalizedSubpath = subpath.startsWith('arcadia/') ? subpath.slice('arcadia/'.length) : subpath;
      const local = path.join(arcRoot, normalizedSubpath);
      const start = fsExistsSync(local) ? path.dirname(local) : arcRoot;
      return path.resolve(findWorkspaceRoot(start) || arcRoot);
    }

    return fallback;
  }

  if (parsedUrl && isLikelyGithubUrl(parsedUrl)) {
    const gitRoot = gitRootFn(projectRoot) || projectRoot;
    const subpath = parseGithubSubpath(parsedUrl);

    if (subpath) {
      const local = path.join(gitRoot, subpath);
      const start = fsExistsSync(local) ? path.dirname(local) : gitRoot;
      return path.resolve(findWorkspaceRoot(start) || gitRoot);
    }

    return path.resolve(findWorkspaceRoot(gitRoot) || gitRoot);
  }

  // Plain filesystem path
  return path.resolve(input);
}

// Exported for unit tests
export const _internal = {
  parseGithubSubpath,
  parseArkSubpath,
  isLikelyGithubUrl,
  isLikelyArcadiaUrl,
  tryParseUrl
};

