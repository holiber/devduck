import fs from 'fs';
import { getDirectorySize } from './installer-utils.js';

export async function showStatus(params: { workspaceRoot: string; cacheDir: string }): Promise<void> {
  const { workspaceRoot, cacheDir } = params;
  const { loadInstallState, getInstallStatePath } = await import('./install-state.js');

  const statePath = getInstallStatePath(workspaceRoot);
  if (!fs.existsSync(statePath)) {
    process.stdout.write('');
    process.exit(0);
  }

  try {
    const state = loadInstallState(workspaceRoot);
    if (!state || Object.keys(state).length === 0) {
      process.stdout.write('');
      process.exit(0);
    }

    const cacheSize = getDirectorySize(cacheDir);
    // Optional dependency: keep `pretty-bytes` for nicer output when installed,
    // but do not require it for bootstrap scenarios (e.g. `barducks new`).
    let cacheSizeFormatted: string;
    try {
      const mod = await import('pretty-bytes');
      const prettyBytes = (mod as { default: (n: number) => string }).default;
      cacheSizeFormatted = prettyBytes(cacheSize);
    } catch {
      cacheSizeFormatted = `${cacheSize} B`;
    }
    const output = {
      status: state,
      cacheSize,
      cacheSizeFormatted
    };

    process.stdout.write(JSON.stringify(output, null, 2));
    process.exit(0);
  } catch {
    process.stdout.write('');
    process.exit(0);
  }
}


