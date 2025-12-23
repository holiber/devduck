const fs = require('fs');
const path = require('path');
const { findWorkspaceRoot } = require('./workspace-root');

/**
 * Resolve where DevDuck project root lives for a module script.
 *
 * In a full workspace install, DevDuck is usually checked out under:
 *   <workspaceRoot>/projects/devduck
 *
 * In this repository (or when running from within DevDuck itself),
 * module scripts live under:
 *   <devduckRoot>/modules/<module>/scripts
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.moduleDir] - usually __dirname from the caller
 * @returns {{ workspaceRoot: string|null, devduckRoot: string }}
 */
function resolveDevduckRoot(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const moduleDir = opts.moduleDir || cwd;

  const workspaceRoot = findWorkspaceRoot(cwd) || findWorkspaceRoot(moduleDir);
  if (workspaceRoot) {
    const candidate = path.join(workspaceRoot, 'projects', 'devduck');
    if (fs.existsSync(candidate)) {
      return { workspaceRoot, devduckRoot: candidate };
    }
    // Workspace root found but project not present; fall back to module-relative.
  }

  // Fallback: assume we're inside the devduck repo and modules/<name>/scripts.
  return { workspaceRoot: workspaceRoot || null, devduckRoot: path.resolve(moduleDir, '../../..') };
}

/**
 * Resolve paths to "core" utilities for module scripts.
 *
 * We support both layouts:
 * - devduckRoot/scripts/... (current repo)
 * - devduckRoot/modules/core/scripts/... (legacy / external packaging)
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {string} [opts.moduleDir]
 * @returns {{ devduckRoot: string, coreUtilsPath: string, coreEnvPath: string }}
 */
function resolveCorePaths(opts = {}) {
  const { devduckRoot } = resolveDevduckRoot(opts);

  const scriptsUtils = path.join(devduckRoot, 'scripts', 'utils.js');
  const scriptsEnv = path.join(devduckRoot, 'scripts', 'lib', 'env.js');

  if (fs.existsSync(scriptsUtils) && fs.existsSync(scriptsEnv)) {
    return { devduckRoot, coreUtilsPath: scriptsUtils, coreEnvPath: scriptsEnv };
  }

  return {
    devduckRoot,
    coreUtilsPath: path.join(devduckRoot, 'modules', 'core', 'scripts', 'utils.js'),
    coreEnvPath: path.join(devduckRoot, 'modules', 'core', 'scripts', 'lib', 'env.js'),
  };
}

module.exports = {
  resolveDevduckRoot,
  resolveCorePaths,
};

