import fs from 'fs';
import path from 'path';
import { findWorkspaceRoot } from './workspace-root.js';

interface ResolveDevduckRootOptions {
  cwd?: string;
  moduleDir?: string;
}

interface ResolveCorePathsOptions {
  cwd?: string;
  moduleDir?: string;
}

interface ResolveDevduckRootResult {
  workspaceRoot: string | null;
  devduckRoot: string;
}

interface ResolveCorePathsResult {
  devduckRoot: string;
  coreUtilsPath: string;
  coreEnvPath: string;
}

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
 * @param opts - Options object
 * @returns Object with workspaceRoot and devduckRoot
 */
export function resolveDevduckRoot(opts: ResolveDevduckRootOptions = {}): ResolveDevduckRootResult {
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
 * @param opts - Options object
 * @returns Object with devduckRoot, coreUtilsPath, and coreEnvPath
 */
export function resolveCorePaths(opts: ResolveCorePathsOptions = {}): ResolveCorePathsResult {
  const { devduckRoot } = resolveDevduckRoot(opts);

  const scriptsUtils = path.join(devduckRoot, 'scripts', 'utils.ts');
  const scriptsEnv = path.join(devduckRoot, 'scripts', 'lib', 'env.ts');

  if (fs.existsSync(scriptsUtils) && fs.existsSync(scriptsEnv)) {
    return { devduckRoot, coreUtilsPath: scriptsUtils, coreEnvPath: scriptsEnv };
  }

  return {
    devduckRoot,
    coreUtilsPath: path.join(devduckRoot, 'modules', 'core', 'scripts', 'utils.ts'),
    coreEnvPath: path.join(devduckRoot, 'modules', 'core', 'scripts', 'lib', 'env.ts')
  };
}

