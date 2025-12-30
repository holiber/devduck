import fs from 'fs';
import path from 'path';
import { findWorkspaceRoot } from './workspace-root.js';

interface ResolveBarducksRootOptions {
  cwd?: string;
  moduleDir?: string;
}

interface ResolveCorePathsOptions {
  cwd?: string;
  moduleDir?: string;
}

interface ResolveBarducksRootResult {
  workspaceRoot: string | null;
  barducksRoot: string;
}

interface ResolveCorePathsResult {
  barducksRoot: string;
  coreUtilsPath: string;
  coreEnvPath: string;
}

/**
 * Resolve where Barducks/Barducks project root lives for an extension script.
 *
 * In a full workspace install, the project is usually checked out under:
 *   <workspaceRoot>/projects/barducks (preferred)
 *   <workspaceRoot>/projects/barducks (legacy)
 *
 * In this repository (or when running from within the project itself),
 * extension scripts live under:
 *   <projectRoot>/extensions/<extension>/scripts
 *
 * @param opts - Options object
 * @returns Object with workspaceRoot and barducksRoot
 */
export function resolveBarducksRoot(opts: ResolveBarducksRootOptions = {}): ResolveBarducksRootResult {
  const cwd = opts.cwd || process.cwd();
  const moduleDir = opts.moduleDir || cwd;

  const workspaceRoot = findWorkspaceRoot(cwd) || findWorkspaceRoot(moduleDir);
  if (workspaceRoot) {
    const preferred = path.join(workspaceRoot, 'projects', 'barducks');
    if (fs.existsSync(preferred)) {
      return { workspaceRoot, barducksRoot: preferred };
    }

    const legacy = path.join(workspaceRoot, 'projects', 'barducks');
    if (fs.existsSync(legacy)) {
      return { workspaceRoot, barducksRoot: legacy };
    }
    // Workspace root found but project not present; fall back to module-relative.
  }

  // Fallback: assume we're inside the repo and extensions/<name>/scripts.
  return { workspaceRoot: workspaceRoot || null, barducksRoot: path.resolve(moduleDir, '../../..') };
}

/**
 * Resolve paths to "core" utilities for module scripts.
 *
 * We support both layouts:
 * - projectRoot/scripts/... (current repo)
 * - projectRoot/extensions/core/scripts/... (legacy / external packaging)
 *
 * @param opts - Options object
 * @returns Object with barducksRoot, coreUtilsPath, and coreEnvPath
 */
export function resolveCorePaths(opts: ResolveCorePathsOptions = {}): ResolveCorePathsResult {
  const { barducksRoot } = resolveBarducksRoot(opts);

  // Preferred (current repo layout): projectRoot/src/...
  const srcUtils = path.join(barducksRoot, 'src', 'utils.ts');
  const srcEnv = path.join(barducksRoot, 'src', 'lib', 'env.ts');

  if (fs.existsSync(srcUtils) && fs.existsSync(srcEnv)) {
    return { barducksRoot, coreUtilsPath: srcUtils, coreEnvPath: srcEnv };
  }

  // Backward compatibility: projectRoot/scripts/... (old layout)
  const scriptsUtils = path.join(barducksRoot, 'scripts', 'utils.ts');
  const scriptsEnv = path.join(barducksRoot, 'scripts', 'lib', 'env.ts');
  if (fs.existsSync(scriptsUtils) && fs.existsSync(scriptsEnv)) {
    return { barducksRoot, coreUtilsPath: scriptsUtils, coreEnvPath: scriptsEnv };
  }

  return {
    barducksRoot,
    coreUtilsPath: path.join(barducksRoot, 'extensions', 'core', 'scripts', 'utils.ts'),
    coreEnvPath: path.join(barducksRoot, 'extensions', 'core', 'scripts', 'lib', 'env.ts')
  };
}

