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
import { spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { compareVersions } from 'compare-versions';

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
  actualPath: string;
  needsSymlink: boolean;
  exists: boolean;
}

/**
 * Find Arcadia root directory
 * @returns Path to Arcadia root or null if not found
 */
function findArcadiaRoot(): string | null {
  // First check ARCADIA_ROOT env var (fastest)
  const envRoot = process.env.ARCADIA_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, '.arcadia.root'))) {
    return envRoot;
  }

  // Execute `arc root` command
  try {
    const output = execSync('arc root', { encoding: 'utf8', stdio: 'pipe' });
    const lines = output.trim().split('\n');
    const arcadiaRoot = lines[lines.length - 1].trim();
    
    if (arcadiaRoot && fs.existsSync(path.join(arcadiaRoot, '.arcadia.root'))) {
      return arcadiaRoot;
    }
  } catch (error) {
    // Command failed, return null
  }

  return null;
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
  const projectsDir = path.join(workspaceRoot, 'projects');
  const barducksRepoPath = path.join(barducksDir, repoName);
  const projectsRepoPath = path.join(projectsDir, repoName);

  // Check if repo exists in projects/ directory
  if (fs.existsSync(projectsRepoPath)) {
    const symlinkExists = fs.existsSync(barducksRepoPath);
    let needsSymlink = false;
    
    if (symlinkExists) {
      try {
        const stats = fs.lstatSync(barducksRepoPath);
        if (stats.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(barducksRepoPath);
          const expectedTarget = path.resolve(projectsRepoPath);
          needsSymlink = path.resolve(currentTarget) !== expectedTarget;
        } else if (stats.isDirectory()) {
          // Directory exists, use it
          needsSymlink = false;
        }
      } catch {
        needsSymlink = true;
      }
    } else {
      needsSymlink = true;
    }

    return {
      barducksPath: barducksRepoPath,
      actualPath: projectsRepoPath,
      needsSymlink,
      exists: true
    };
  }

  // Handle Arcadia repositories
  if (parsed.type === 'arc') {
    let actualRepoPath: string;

    if (path.isAbsolute(parsed.normalized)) {
      actualRepoPath = parsed.normalized;
    } else {
      const arcadiaRoot = findArcadiaRoot();
      if (!arcadiaRoot) {
        throw new Error('Cannot determine Arcadia root. Set ARCADIA_ROOT environment variable or run from Arcadia directory.');
      }
      actualRepoPath = path.join(arcadiaRoot, parsed.normalized);
    }

    if (!fs.existsSync(actualRepoPath)) {
      throw new Error(`Arcadia repository not found: ${actualRepoPath}`);
    }

    const symlinkExists = fs.existsSync(barducksRepoPath);
    let needsSymlink = false;

    if (symlinkExists) {
      try {
        const stats = fs.lstatSync(barducksRepoPath);
        if (stats.isSymbolicLink()) {
          const currentTarget = fs.readlinkSync(barducksRepoPath);
          const expectedTarget = path.resolve(actualRepoPath);
          needsSymlink = path.resolve(currentTarget) !== expectedTarget;
        } else if (stats.isDirectory()) {
          needsSymlink = false;
        }
      } catch {
        needsSymlink = true;
      }
    } else {
      needsSymlink = true;
    }

    return {
      barducksPath: barducksRepoPath,
      actualPath: actualRepoPath,
      needsSymlink,
      exists: true
    };
  }

  // Handle Git repositories
  if (parsed.type === 'git') {
    const repoPath = barducksRepoPath;
    const exists = fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'));

    return {
      barducksPath: repoPath,
      actualPath: repoPath,
      needsSymlink: false,
      exists
    };
  }

  throw new Error(`Unsupported repository type: ${parsed.type}`);
}

/**
 * Create symlink from barducks path to actual path
 */
function createSymlink(barducksPath: string, actualPath: string, repoName: string): void {
  const barducksDir = path.dirname(barducksPath);
  fs.mkdirSync(barducksDir, { recursive: true });

  // Remove existing symlink if it points to wrong target
  if (fs.existsSync(barducksPath)) {
    try {
      const stats = fs.lstatSync(barducksPath);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(barducksPath);
      } else if (stats.isDirectory()) {
        // Don't overwrite existing directory
        return;
      }
    } catch (error) {
      // Continue to create symlink
    }
  }

  try {
    fs.symlinkSync(actualPath, barducksPath, 'dir');
    print(`  ${symbols.info} Created symlink: barducks/${repoName} -> ${path.relative(path.dirname(barducksPath), actualPath)}`, 'cyan');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to create symlink, using path directly: ${err.message}`, 'yellow');
    throw err;
  }
}

/**
 * Clone git repository
 */
function cloneGitRepository(repoUrl: string, repoPath: string): void {
  const barducksDir = path.dirname(repoPath);
  fs.mkdirSync(barducksDir, { recursive: true });

  print(`  ${symbols.info} Cloning repository: ${repoUrl}`, 'cyan');
  
  const cloneResult = spawnSync('git', ['clone', repoUrl, repoPath], {
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (cloneResult.status !== 0) {
    throw new Error(`Failed to clone repository: ${repoUrl}`);
  }
}

/**
 * Update existing git repository
 */
function updateGitRepository(repoPath: string): void {
  const repoName = path.basename(repoPath);
  print(`  ${symbols.info} Updating existing git repository: ${repoName}`, 'cyan');
  
  const pullResult = spawnSync('git', ['pull'], {
    cwd: repoPath,
    encoding: 'utf8'
  });

  if (pullResult.status !== 0) {
    print(`  ${symbols.warning} Failed to update repository, using existing version`, 'yellow');
  }
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
  const parsed = parseRepoUrl(repoUrl);
  const repoName = extractRepoName(parsed);

  // Handle symlink creation
  if (pathInfo.needsSymlink) {
    createSymlink(pathInfo.barducksPath, pathInfo.actualPath, repoName);
    return pathInfo.barducksPath;
  }

  // Handle git repository cloning/updating
  if (parsed.type === 'git' && !pathInfo.exists) {
    cloneGitRepository(parsed.normalized, pathInfo.barducksPath);
    return pathInfo.barducksPath;
  }

  if (parsed.type === 'git' && pathInfo.exists) {
    updateGitRepository(pathInfo.barducksPath);
    return pathInfo.barducksPath;
  }

  // Repository already exists and is accessible
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
