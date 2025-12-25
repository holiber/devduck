#!/usr/bin/env node

/**
 * Repository modules loader for devduck
 *
 * Handles loading modules from external repositories:
 * - Git repositories (github.com, git@github.com)
 * - Arcadia repositories (arc://, a.yandex-team.ru/arc/)
 * - Version checking via manifest.json
 */

import fs from 'fs';
import path from 'path';
import { execCmdSync } from './process.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import utils - will be loaded when module is imported
import { print as printUtil, symbols as symbolsUtil } from '../utils.js';

// Use imported utils with fallback
const print: (msg: string, color?: string) => void = printUtil || ((msg: string) => console.log(msg));
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

/**
 * Compare semantic versions
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parseVersion = (v: string): number[] => {
    return v.split('.').map(part => {
      // Remove any non-numeric suffix (e.g., "0.1.0-beta" -> "0.1.0")
      const numPart = part.replace(/[^0-9].*$/, '');
      return parseInt(numPart || '0', 10);
    });
  };

  const parts1 = parseVersion(v1);
  const parts2 = parseVersion(v2);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }

  return 0;
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

  if (trimmed.startsWith('a.yandex-team.ru/arc/')) {
    return {
      type: 'arc',
      normalized: trimmed.replace(/^a\.yandex-team\.ru\/arc\//, '')
    };
  }

  // Git formats
  if (trimmed.startsWith('git@')) {
    // git@github.com:user/repo.git
    return {
      type: 'git',
      normalized: trimmed
    };
  }

  if (trimmed.includes('github.com')) {
    // github.com/user/repo or https://github.com/user/repo
    let normalized = trimmed;
    if (normalized.startsWith('https://')) {
      // Already HTTPS, use as-is
      if (!normalized.endsWith('.git')) {
        normalized = `${normalized}.git`;
      }
      return {
        type: 'git',
        normalized: normalized
      };
    }
    if (normalized.startsWith('http://')) {
      // HTTP, convert to HTTPS
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
 * Resolve repository path to local filesystem path
 * @param repoUrl - Repository URL
 * @param workspaceRoot - Workspace root directory
 * @returns Local path to repository (in devduck/ directory, or symlink to projects/)
 */
export async function resolveRepoPath(repoUrl: string, workspaceRoot: string): Promise<string> {
  const parsed = parseRepoUrl(repoUrl);
  // External module repositories should be materialized inside the workspace's `devduck/` folder
  // (so they are easy to inspect/edit), not hidden under `.cache/`.
  // Note: place them directly under `devduck/` (e.g. `devduck/<repo-id>/`) rather than `devduck/repos/`.
  const devduckDir = path.join(workspaceRoot, 'devduck');
  const projectsDir = path.join(workspaceRoot, 'projects');

  // Extract repo name from URL
  let repoName: string;
  if (parsed.type === 'arc') {
    repoName = path.basename(parsed.normalized);
  } else {
    // Git: extract repo name from URL
    repoName = parsed.normalized
      .replace(/^git@/, '')
      .replace(/\.git$/, '')
      .replace(/[:\/]/g, '_');
  }

  const devduckRepoPath = path.join(devduckDir, repoName);
  const projectsRepoPath = path.join(projectsDir, repoName);

  // Check if repo exists in projects/ directory
  if (fs.existsSync(projectsRepoPath)) {
    // Create symlink from devduck/%repo_name% to projects/%repo_name%
    fs.mkdirSync(devduckDir, { recursive: true });
    
    // Remove existing symlink or directory if it exists
    if (fs.existsSync(devduckRepoPath)) {
      try {
        const stats = fs.lstatSync(devduckRepoPath);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(devduckRepoPath);
        } else if (stats.isDirectory()) {
          // If it's a directory (not a symlink), we should not overwrite it
          // Return the existing directory path
          return devduckRepoPath;
        }
      } catch (error) {
        // If we can't check/remove, continue and try to create symlink
      }
    }

    // Create symlink
    try {
      fs.symlinkSync(projectsRepoPath, devduckRepoPath, 'dir');
      print(`  ${symbols.info} Created symlink: devduck/${repoName} -> projects/${repoName}`, 'cyan');
      return devduckRepoPath;
    } catch (error) {
      const err = error as Error;
      // If symlink creation fails, fall back to using projects path directly
      print(`  ${symbols.warning} Failed to create symlink, using projects path directly: ${err.message}`, 'yellow');
      return projectsRepoPath;
    }
  }

  // Repo doesn't exist in projects/, use normal resolution logic
  if (parsed.type === 'arc') {
    // Arcadia: use direct filesystem path
    // Normalized path can be:
    // - Relative to arcadia root: "junk/user/repo-name"
    // - Absolute path: "/path/to/arcadia/junk/user/repo-name"

    let actualRepoPath: string;

    // Check if it's already an absolute path
    if (path.isAbsolute(parsed.normalized)) {
      actualRepoPath = parsed.normalized;
    } else {
      // Try to find arcadia root
      // First check ARCADIA_ROOT env var
      let arcadiaRoot = process.env.ARCADIA_ROOT;

      // If not set, try to detect from current working directory
      if (!arcadiaRoot) {
        let currentDir = process.cwd();
        const maxDepth = 10;
        let depth = 0;

        while (depth < maxDepth) {
          const arcadiaRootFile = path.join(currentDir, '.arcadia.root');
          if (fs.existsSync(arcadiaRootFile)) {
            arcadiaRoot = currentDir;
            break;
          }
          const parent = path.dirname(currentDir);
          if (parent === currentDir) {
            break;
          }
          currentDir = parent;
          depth++;
        }
      }

      // Fallback to common arcadia locations
      if (!arcadiaRoot) {
        const possibleRoots = ['/Users/alex-nazarov/arcadia', '/arcadia', process.cwd()];

        for (const possibleRoot of possibleRoots) {
          if (fs.existsSync(path.join(possibleRoot, '.arcadia.root'))) {
            arcadiaRoot = possibleRoot;
            break;
          }
        }
      }

      if (!arcadiaRoot) {
        throw new Error('Cannot determine Arcadia root. Set ARCADIA_ROOT environment variable or run from Arcadia directory.');
      }

      actualRepoPath = path.join(arcadiaRoot, parsed.normalized);
    }

    if (!fs.existsSync(actualRepoPath)) {
      throw new Error(`Arcadia repository not found: ${actualRepoPath}`);
    }

    // Create symlink from devduck/%repo_name% to actual repo path
    fs.mkdirSync(devduckDir, { recursive: true });
    
    // Remove existing symlink or directory if it exists
    if (fs.existsSync(devduckRepoPath)) {
      try {
        const stats = fs.lstatSync(devduckRepoPath);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(devduckRepoPath);
        } else if (stats.isDirectory()) {
          // If it's a directory (not a symlink), return it
          return devduckRepoPath;
        }
      } catch (error) {
        // If we can't check/remove, continue and try to create symlink
      }
    }

    // Create symlink
    try {
      fs.symlinkSync(actualRepoPath, devduckRepoPath, 'dir');
      print(`  ${symbols.info} Created symlink: devduck/${repoName} -> ${actualRepoPath}`, 'cyan');
      return devduckRepoPath;
    } catch (error) {
      const err = error as Error;
      // If symlink creation fails, fall back to using actual path directly
      print(`  ${symbols.warning} Failed to create symlink, using actual path directly: ${err.message}`, 'yellow');
      return actualRepoPath;
    }
  }

  if (parsed.type === 'git') {
    // Git: clone to devduck directory
    const repoPath = devduckRepoPath;

    // Check if already cloned
    if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) {
      // Update existing clone
      print(`  ${symbols.info} Updating existing git repository: ${repoName}`, 'cyan');
      const pullResult = execCmdSync('git', ['pull'], { cwd: repoPath });
      if (!pullResult.ok) {
        print(`  ${symbols.warning} Failed to update repository, using existing version`, 'yellow');
      }

      return repoPath;
    }

    // Clone repository
    print(`  ${symbols.info} Cloning repository: ${parsed.normalized}`, 'cyan');
    fs.mkdirSync(devduckDir, { recursive: true });

    const cloneResult = execCmdSync('git', ['clone', parsed.normalized, repoPath], { stdio: 'inherit' });
    if (!cloneResult.ok) {
      throw new Error(`Failed to clone repository: ${parsed.normalized}`);
    }

    return repoPath;
  }

  throw new Error(`Unsupported repository type: ${parsed.type}`);
}

/**
 * Check repository version compatibility
 * @param repoPath - Local path to repository
 * @param devduckVersion - Expected devduck version
 * @returns Version check result
 */
export async function checkRepoVersion(repoPath: string, devduckVersion: string): Promise<VersionCheckResult> {
  // Try manifest.json first, then devduck.manifest.json
  const manifestPaths = [
    path.join(repoPath, 'manifest.json'),
    path.join(repoPath, 'devduck.manifest.json')
  ];

  for (const manifestPath of manifestPaths) {
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const repoVersion = manifest.devduckVersion;

        if (!repoVersion) {
          return {
            compatible: false,
            version: null,
            error: `manifest.json found but devduckVersion is missing`
          };
        }

        // Compare versions: module is compatible if its devduckVersion <= current devduck version
        // This allows backward compatibility (old modules work with new devduck)
        // Error only if module requires newer devduck version (repoVersion > devduckVersion)
        const versionComparison = compareVersions(repoVersion, devduckVersion);
        
        if (versionComparison > 0) {
          // Module requires newer devduck version
          return {
            compatible: false,
            version: repoVersion,
            error: `Module requires devduck version ${repoVersion} or higher, but current version is ${devduckVersion}`
          };
        }

        // Module is compatible (repoVersion <= devduckVersion)
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
          error: `Failed to parse manifest.json: ${error.message}`
        };
      }
    }
  }

  // No manifest found
  return {
    compatible: false,
    version: null,
    error: 'manifest.json or devduck.manifest.json not found'
  };
}

/**
 * Load modules from repository
 * @param repoUrl - Repository URL
 * @param workspaceRoot - Workspace root directory
 * @param devduckVersion - Expected devduck version
 * @returns Path to modules directory
 */
export async function loadModulesFromRepo(
  repoUrl: string,
  workspaceRoot: string,
  devduckVersion: string
): Promise<string> {
  const repoPath = await resolveRepoPath(repoUrl, workspaceRoot);

  // Check version compatibility
  const versionCheck = await checkRepoVersion(repoPath, devduckVersion);

  if (!versionCheck.compatible) {
    throw new Error(`Repository ${repoUrl} is not compatible: ${versionCheck.error}`);
  }

  // Find modules directory
  const modulesPath = path.join(repoPath, 'modules');

  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules directory not found in repository: ${repoUrl}`);
  }

  // Don't print success message here - let caller print it after modules are loaded
  // This avoids the appearance of the script being "stuck" while loading modules

  return modulesPath;
}

/**
 * Get devduck version from package.json
 * @returns Devduck version
 */
export function getDevduckVersion(): string {
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

