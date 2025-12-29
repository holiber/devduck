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
 * Resolve where Barducks/DevDuck project root lives for an extension script.
 *
 * In a full workspace install, the project is usually checked out under:
 *   <workspaceRoot>/projects/barducks (preferred)
 *   <workspaceRoot>/projects/devduck (legacy)
 *
 * In this repository (or when running from within the project itself),
 * extension scripts live under:
 *   <projectRoot>/extensions/<extension>/scripts
 *
 * @param opts - Options object
 * @returns Object with workspaceRoot and devduckRoot
 */
export function resolveDevduckRoot(opts: ResolveDevduckRootOptions = {}): ResolveDevduckRootResult {
  const cwd = opts.cwd || process.cwd();
  const moduleDir = opts.moduleDir || cwd;

  const workspaceRoot = findWorkspaceRoot(cwd) || findWorkspaceRoot(moduleDir);
  if (workspaceRoot) {
    const preferred = path.join(workspaceRoot, 'projects', 'barducks');
    if (fs.existsSync(preferred)) {
      return { workspaceRoot, devduckRoot: preferred };
    }

    const legacy = path.join(workspaceRoot, 'projects', 'devduck');
    if (fs.existsSync(legacy)) {
      return { workspaceRoot, devduckRoot: legacy };
    }
    // Workspace root found but project not present; fall back to module-relative.
  }

  // Fallback: assume we're inside the repo and extensions/<name>/scripts.
  return { workspaceRoot: workspaceRoot || null, devduckRoot: path.resolve(moduleDir, '../../..') };
}

/**
 * Resolve paths to "core" utilities for module scripts.
 *
 * We support both layouts:
 * - projectRoot/scripts/... (current repo)
 * - projectRoot/extensions/core/scripts/... (legacy / external packaging)
 *
 * @param opts - Options object
 * @returns Object with devduckRoot, coreUtilsPath, and coreEnvPath
 */
export function resolveCorePaths(opts: ResolveCorePathsOptions = {}): ResolveCorePathsResult {
  const { devduckRoot } = resolveDevduckRoot(opts);

  // Preferred (current repo layout): projectRoot/src/...
  const srcUtils = path.join(devduckRoot, 'src', 'utils.ts');
  const srcEnv = path.join(devduckRoot, 'src', 'lib', 'env.ts');

  if (fs.existsSync(srcUtils) && fs.existsSync(srcEnv)) {
    return { devduckRoot, coreUtilsPath: srcUtils, coreEnvPath: srcEnv };
  }

  // Backward compatibility: projectRoot/scripts/... (old layout)
  const scriptsUtils = path.join(devduckRoot, 'scripts', 'utils.ts');
  const scriptsEnv = path.join(devduckRoot, 'scripts', 'lib', 'env.ts');
  if (fs.existsSync(scriptsUtils) && fs.existsSync(scriptsEnv)) {
    return { devduckRoot, coreUtilsPath: scriptsUtils, coreEnvPath: scriptsEnv };
  }

  return {
    devduckRoot,
    coreUtilsPath: path.join(devduckRoot, 'extensions', 'core', 'scripts', 'utils.ts'),
    coreEnvPath: path.join(devduckRoot, 'extensions', 'core', 'scripts', 'lib', 'env.ts')
  };
}

