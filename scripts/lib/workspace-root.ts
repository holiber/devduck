import fs from 'fs';
import path from 'path';
import { WORKSPACE_CONFIG_BASENAMES } from './workspace-config.js';

interface FindWorkspaceRootOptions {
  maxDepth?: number;
  markerFile?: string;
}

/**
 * Find workspace root by walking parent directories until a workspace config file is found.
 *
 * This is intentionally small and dependency-free because it is used by multiple modules.
 *
 * @param startPath - Starting directory path
 * @param opts - Options object
 * @returns Workspace root path or null if not found
 */
export function findWorkspaceRoot(
  startPath: string = process.cwd(),
  opts: FindWorkspaceRootOptions = {}
): string | null {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 10;
  const markerFile = opts.markerFile || null;

  let current = path.resolve(startPath);
  for (let depth = 0; depth < maxDepth; depth++) {
    if (markerFile) {
      const markerPath = path.join(current, markerFile);
      if (fs.existsSync(markerPath)) return current;
    } else {
      for (const name of WORKSPACE_CONFIG_BASENAMES) {
        const p = path.join(current, name);
        if (fs.existsSync(p)) return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

