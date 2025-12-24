const fs = require('fs');
const path = require('path');

/**
 * Find workspace root by walking parent directories until `workspace.config.json` is found.
 *
 * This is intentionally small and dependency-free because it is used by multiple modules.
 *
 * @param {string} [startPath]
 * @param {object} [opts]
 * @param {number} [opts.maxDepth]
 * @param {string} [opts.markerFile]
 * @returns {string|null}
 */
function findWorkspaceRoot(startPath = process.cwd(), opts = {}) {
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

module.exports = {
  findWorkspaceRoot,
};

