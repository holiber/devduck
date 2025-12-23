const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { URL } = require('url');

function tryParseUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // URL() requires a scheme; allow common scheme-less patterns if needed later.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return null;

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function getGitRoot(cwd) {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  return out ? out : null;
}

function getArcadiaRoot() {
  const res = spawnSync('arc', ['root'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  return out ? out : null;
}

function parseGithubSubpath(url) {
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

function parseArcadiaSubpath(url) {
  // Common web link:
  // - https://a.yandex-team.ru/arcadia/<path>
  const host = (url.hostname || '').toLowerCase();
  const pathname = url.pathname || '';

  if ((host === 'a.yandex-team.ru' || host.endsWith('.yandex-team.ru')) && pathname.includes('/arcadia/')) {
    const idx = pathname.indexOf('/arcadia/');
    return pathname.slice(idx + '/arcadia/'.length).replace(/^\/+/, '');
  }

  return null;
}

function isLikelyArcadiaUrl(url) {
  const host = (url.hostname || '').toLowerCase();
  const pathname = url.pathname || '';
  return (host === 'a.yandex-team.ru' || host.endsWith('.yandex-team.ru')) && pathname.includes('/arcadia/');
}

function isLikelyGithubUrl(url) {
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
 * @param {string} workspacePathInput
 * @param {object} [opts]
 * @param {string} [opts.projectRoot] - Used as cwd fallback when resolving VCS roots
 * @param {(startPath: string) => (string|null)} [opts.findWorkspaceRoot]
 * @param {(cwd: string) => (string|null)} [opts.getGitRoot]
 * @param {() => (string|null)} [opts.getArcadiaRoot]
 * @param {(p: string) => boolean} [opts.fsExistsSync]
 * @returns {string} absolute path to workspace root
 */
function resolveWorkspaceRoot(workspacePathInput, opts = {}) {
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
    const subpath = parseArcadiaSubpath(parsedUrl);

    if (arcRoot && subpath) {
      const local = path.join(arcRoot, subpath);
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

module.exports = {
  resolveWorkspaceRoot,
  // exported for unit tests
  _internal: {
    parseGithubSubpath,
    parseArcadiaSubpath,
    isLikelyGithubUrl,
    isLikelyArcadiaUrl,
    tryParseUrl
  }
};

