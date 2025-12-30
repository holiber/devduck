import fs from 'fs';
import path from 'path';

import { resolveBarducksRoot } from './barducks-paths.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from './workspace-config.js';
import { loadModulesFromRepo, getBarducksVersion } from './repo-modules.js';

type WorkspaceConfigLike = {
  repos?: string[];
};

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

export type CollectExtensionsDirsArgs = {
  cwd: string;
  moduleDir: string;
  workspaceRoot: string | null;
  includeLegacyModulesDir?: boolean;
};

/**
 * Returns directories that contain extensions/modules to scan (built-in + workspace repos).
 * This is shared between unified API collection and provider discovery to avoid drift/duplication.
 */
export async function collectExtensionsDirs(args: CollectExtensionsDirsArgs): Promise<string[]> {
  const { cwd, moduleDir, workspaceRoot } = args;

  const { barducksRoot } = resolveBarducksRoot({ cwd, moduleDir });
  const baseDirs = [
    path.join(barducksRoot, 'extensions'),
    args.includeLegacyModulesDir ? path.join(barducksRoot, 'modules') : null
  ].filter(Boolean) as string[];

  const dirs: string[] = baseDirs.filter((d) => fs.existsSync(d));

  if (!workspaceRoot) return uniq(dirs);

  const configPath = getWorkspaceConfigFilePath(workspaceRoot);
  if (!fs.existsSync(configPath)) return uniq(dirs);

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const repos = (cfg && Array.isArray(cfg.repos) ? cfg.repos : []) || [];
  if (repos.length === 0) return uniq(dirs);

  const barducksVersion = getBarducksVersion();
  for (const repoUrl of repos) {
    try {
      const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, barducksVersion);
      if (fs.existsSync(repoModulesPath)) {
        dirs.push(repoModulesPath);
      }
    } catch {
      // Keep discovery best-effort; callers decide whether to log.
    }
  }

  return uniq(dirs);
}

