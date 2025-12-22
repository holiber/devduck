#!/usr/bin/env node

/**
 * Repository modules loader for devduck
 * 
 * Handles loading modules from external repositories:
 * - Git repositories (github.com, git@github.com)
 * - Arcadia repositories (arc://, a.yandex-team.ru/arc/)
 * - Version checking via manifest.json
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { print, symbols } = require('../../modules/core/scripts/utils');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Parse repository URL and determine type
 * @param {string} repoUrl - Repository URL
 * @returns {object} - { type: 'git'|'arc', normalized: string }
 */
function parseRepoUrl(repoUrl) {
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
      normalized = normalized.replace(/^https:\/\//, '');
    }
    if (normalized.startsWith('http://')) {
      normalized = normalized.replace(/^http:\/\//, '');
    }
    if (!normalized.endsWith('.git')) {
      normalized = `${normalized}.git`;
    }
    // Convert to git@ format for cloning
    const match = normalized.match(/github\.com[\/:](.+?)(?:\.git)?$/);
    if (match) {
      return {
        type: 'git',
        normalized: `git@github.com:${match[1]}.git`
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
 * @param {string} repoUrl - Repository URL
 * @param {string} workspaceRoot - Workspace root directory
 * @returns {Promise<string>} - Local path to repository
 */
async function resolveRepoPath(repoUrl, workspaceRoot) {
  const parsed = parseRepoUrl(repoUrl);
  const cacheDir = path.join(workspaceRoot, '.cache', 'devduck', 'repos');

  if (parsed.type === 'arc') {
    // Arcadia: use direct filesystem path
    // Normalized path can be:
    // - Relative to arcadia root: "junk/alex-nazarov/devduck-ya-modules"
    // - Absolute path: "/Users/alex-nazarov/arcadia/junk/alex-nazarov/devduck-ya-modules"
    
    let repoPath;
    
    // Check if it's already an absolute path
    if (path.isAbsolute(parsed.normalized)) {
      repoPath = parsed.normalized;
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
        const possibleRoots = [
          '/Users/alex-nazarov/arcadia',
          '/arcadia',
          process.cwd()
        ];
        
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
      
      repoPath = path.join(arcadiaRoot, parsed.normalized);
    }
    
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Arcadia repository not found: ${repoPath}`);
    }
    
    return repoPath;
  }

  if (parsed.type === 'git') {
    // Git: clone to cache directory
    // Use repo name as directory name
    const repoName = parsed.normalized
      .replace(/^git@/, '')
      .replace(/\.git$/, '')
      .replace(/[:\/]/g, '_');
    
    const repoPath = path.join(cacheDir, repoName);
    
    // Check if already cloned
    if (fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, '.git'))) {
      // Update existing clone
      print(`  ${symbols.info} Updating existing git repository: ${repoName}`, 'cyan');
      const pullResult = spawnSync('git', ['pull'], {
        cwd: repoPath,
        encoding: 'utf8'
      });
      
      if (pullResult.status !== 0) {
        print(`  ${symbols.warning} Failed to update repository, using existing version`, 'yellow');
      }
      
      return repoPath;
    }
    
    // Clone repository
    print(`  ${symbols.info} Cloning repository: ${parsed.normalized}`, 'cyan');
    fs.mkdirSync(cacheDir, { recursive: true });
    
    const cloneResult = spawnSync('git', ['clone', parsed.normalized, repoPath], {
      encoding: 'utf8',
      stdio: 'inherit'
    });
    
    if (cloneResult.status !== 0) {
      throw new Error(`Failed to clone repository: ${parsed.normalized}`);
    }
    
    return repoPath;
  }

  throw new Error(`Unsupported repository type: ${parsed.type}`);
}

/**
 * Check repository version compatibility
 * @param {string} repoPath - Local path to repository
 * @param {string} devduckVersion - Expected devduck version
 * @returns {Promise<{compatible: boolean, version: string|null, error: string|null}>}
 */
async function checkRepoVersion(repoPath, devduckVersion) {
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
        
        // Strict version comparison
        if (repoVersion !== devduckVersion) {
          return {
            compatible: false,
            version: repoVersion,
            error: `Version mismatch: expected ${devduckVersion}, got ${repoVersion}`
          };
        }
        
        return {
          compatible: true,
          version: repoVersion,
          error: null
        };
      } catch (e) {
        return {
          compatible: false,
          version: null,
          error: `Failed to parse manifest.json: ${e.message}`
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
 * @param {string} repoUrl - Repository URL
 * @param {string} workspaceRoot - Workspace root directory
 * @param {string} devduckVersion - Expected devduck version
 * @returns {Promise<string>} - Path to modules directory
 */
async function loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion) {
  const repoPath = await resolveRepoPath(repoUrl, workspaceRoot);
  
  // Check version compatibility
  const versionCheck = await checkRepoVersion(repoPath, devduckVersion);
  
  if (!versionCheck.compatible) {
    throw new Error(
      `Repository ${repoUrl} is not compatible: ${versionCheck.error}`
    );
  }
  
  // Find modules directory
  const modulesPath = path.join(repoPath, 'modules');
  
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules directory not found in repository: ${repoUrl}`);
  }
  
  print(`  ${symbols.success} Repository ${repoUrl} loaded (version ${versionCheck.version})`, 'green');
  
  return modulesPath;
}

/**
 * Get devduck version from package.json
 * @returns {string} - Devduck version
 */
function getDevduckVersion() {
  const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('package.json not found');
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || '0.1.0';
  } catch (e) {
    throw new Error(`Failed to read package.json: ${e.message}`);
  }
}

module.exports = {
  parseRepoUrl,
  resolveRepoPath,
  checkRepoVersion,
  loadModulesFromRepo,
  getDevduckVersion
};

