#!/usr/bin/env node

/**
 * Repository modules loader for barducks
 *
 * Handles loading modules from external repositories:
 * - Git repositories (github.com, git@github.com)
 * - Arcadia repositories (arc://)
 * - Version checking via barducks.manifest.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { compareVersions } from 'compare-versions';
import { installWithProvider } from '../../extensions/installer/lib/installer-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import utils - will be loaded when module is imported
import { print as printUtil, symbols as symbolsUtil } from '../utils.js';

// Use imported utils with fallback
const print = printUtil || ((msg: string) => console.log(msg));
const symbols = symbolsUtil || {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗'
};

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

interface RepoUrlParseResult {
  type: 'git' | 'arc';
  normalized: string;
}

interface VersionCheckResult {
  compatible: boolean;
  version: string | null;
  error: string | null;
}

interface RepoPathInfo {
  barducksPath: string;
  exists: boolean;
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/**
 * Parse repository URL and determine type
 * @param repoUrl - Repository URL
 * @returns Object with type and normalized URL
 */
export function parseRepoUrl(repoUrl: string): RepoUrlParseResult {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Invalid repository URL');
  }

  const trimmed = repoUrl.trim();

  // Arcadia formats
  if (trimmed.startsWith('arc://')) {
    return {
      type: 'arc',
      normalized: trimmed.replace(/^arc:\/\//, '')
    };
  }

  // Git formats
  if (trimmed.startsWith('git@')) {
    return {
      type: 'git',
      normalized: trimmed
    };
  }

  if (trimmed.includes('github.com')) {
    let normalized = trimmed;
    if (normalized.startsWith('https://')) {
      if (!normalized.endsWith('.git')) {
        normalized = `${normalized}.git`;
      }
      return {
        type: 'git',
        normalized: normalized
      };
    }
    if (normalized.startsWith('http://')) {
      normalized = normalized.replace(/^http:\/\//, 'https://');
      if (!normalized.endsWith('.git')) {
        normalized = `${normalized}.git`;
      }
      return {
        type: 'git',
        normalized: normalized
      };
    }
    // github.com/user/repo format - convert to HTTPS for CI compatibility
    const match = normalized.match(/github\.com[\/:](.+?)(?:\.git)?$/);
    if (match) {
      return {
        type: 'git',
        normalized: `https://github.com/${match[1]}.git`
      };
    }
  }

  // Default: assume it's a git URL
  return {
    type: 'git',
    normalized: trimmed
  };
}

/**
 * Extract repository name from URL
 */
function extractRepoName(parsed: RepoUrlParseResult): string {
  if (parsed.type === 'arc') {
    return path.basename(parsed.normalized);
  } else {
    // Git: extract repo name from URL
    return parsed.normalized
      .replace(/^git@/, '')
      .replace(/\.git$/, '')
      .replace(/[:\/]/g, '_');
  }
}

/**
 * Resolve repository path (read-only operation)
 * Determines where the repository should be or is located, without creating anything.
 * @param repoUrl - Repository URL
 * @param workspaceRoot - Workspace root directory
 * @returns Information about repository paths
 */
export function resolveRepoPath(repoUrl: string, workspaceRoot: string): RepoPathInfo {
  const parsed = parseRepoUrl(repoUrl);
  const repoName = extractRepoName(parsed);
  
  const barducksDir = path.join(workspaceRoot, 'barducks');
  const barducksRepoPath = path.join(barducksDir, repoName);
  const exists = fs.existsSync(barducksRepoPath);

  return {
    barducksPath: barducksRepoPath,
    exists
  };
}

/**
 * Ensure repository is available (creates symlinks, clones repos if needed)
 * This function has side effects and should only be called during installation.
 * @param repoUrl - Repository URL
 * @param workspaceRoot - Workspace root directory
 * @returns Path to repository
 */
export async function ensureRepoAvailable(
  repoUrl: string,
  workspaceRoot: string
): Promise<string> {
  const pathInfo = resolveRepoPath(repoUrl, workspaceRoot);
  ensureDir(path.dirname(pathInfo.barducksPath));

  if (!pathInfo.exists) {
    print(`  ${symbols.info} Installing repository via installer: ${repoUrl}`, 'cyan');
    await installWithProvider({
      src: repoUrl,
      dest: pathInfo.barducksPath,
      force: false,
      // Avoid recursion: provider discovery uses extension discovery which (for workspaceRoot)
      // may attempt to load repos via this same module.
      workspaceRoot: null,
      quiet: true
    });
  }

  return pathInfo.barducksPath;
}

/**
 * Check repository version compatibility
 * @param repoPath - Local path to repository
 * @param barducksVersion - Expected barducks version
 * @returns Version check result
 */
export async function checkRepoVersion(repoPath: string, barducksVersion: string): Promise<VersionCheckResult> {
  // Backward compatibility:
  // - New format: barducks.manifest.json
  // - Legacy/test format: manifest.json
  const manifestPath = path.join(repoPath, 'barducks.manifest.json');
  const legacyManifestPath = path.join(repoPath, 'manifest.json');
  const effectiveManifestPath = fs.existsSync(manifestPath)
    ? manifestPath
    : (fs.existsSync(legacyManifestPath) ? legacyManifestPath : null);

  if (effectiveManifestPath) {
    try {
      const manifest = JSON.parse(fs.readFileSync(effectiveManifestPath, 'utf8'));
      const repoVersion = manifest.barducksVersion;

      if (!repoVersion) {
        return {
          compatible: false,
          version: null,
          error: `${path.basename(effectiveManifestPath)} found but barducksVersion is missing`
        };
      }

      // Compare versions: module is compatible if its barducksVersion <= current barducks version
      const versionComparison = compareVersions(repoVersion, barducksVersion);
      
      if (versionComparison > 0) {
        return {
          compatible: false,
          version: repoVersion,
          error: `Module requires barducks version ${repoVersion} or higher, but current version is ${barducksVersion}`
        };
      }

      return {
        compatible: true,
        version: repoVersion,
        error: null
      };
    } catch (e) {
      const error = e as Error;
      return {
        compatible: false,
        version: null,
        error: `Failed to parse ${effectiveManifestPath}: ${error.message}`
      };
    }
  }

  return {
    compatible: false,
    version: null,
    error: 'No manifest found (barducks.manifest.json or manifest.json)'
  };
}

/**
 * Load modules from repository
 * @param repoUrl - Repository URL
 * @param workspaceRoot - Workspace root directory
 * @param barducksVersion - Expected barducks version
 * @returns Path to extensions directory (legacy: modules directory)
 */
export async function loadModulesFromRepo(
  repoUrl: string,
  workspaceRoot: string,
  barducksVersion: string
): Promise<string> {
  const repoPath = await ensureRepoAvailable(repoUrl, workspaceRoot);

  // Check version compatibility
  const versionCheck = await checkRepoVersion(repoPath, barducksVersion);

  if (!versionCheck.compatible) {
    throw new Error(`Repository ${repoUrl} is not compatible: ${versionCheck.error}`);
  }

  // Find extensions directory.
  const extensionsPath = path.join(repoPath, 'extensions');
  if (fs.existsSync(extensionsPath)) {
    return extensionsPath;
  }
  throw new Error(`extensions directory not found in repository: ${repoUrl}`);
}

/**
 * Get barducks version from package.json
 * @returns Barducks version
 */
export function getBarducksVersion(): string {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '0.1.0';
  } catch (e) {
    const error = e as Error;
    throw new Error(`Failed to read package.json: ${error.message}`);
  }
}
