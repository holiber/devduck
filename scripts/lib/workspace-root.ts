import fs from 'fs';
import path from 'path';

interface FindWorkspaceRootOptions {
  maxDepth?: number;
  markerFile?: string;
}

/**
 * Find workspace root by walking parent directories until `workspace.config.json` is found.
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
  const markerFile = opts.markerFile || 'workspace.config.json';

  let current = path.resolve(startPath);
  for (let depth = 0; depth < maxDepth; depth++) {
    const markerPath = path.join(current, markerFile);
    if (fs.existsSync(markerPath)) return current;

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

