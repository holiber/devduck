import fs from 'fs';
import path from 'path';

import { resolveBarducksRoot } from './barducks-paths.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from './workspace-config.js';
import { parseRepoUrl } from './repo-modules.js';

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
  quiet?: boolean;
};

function hasExtensionsOrModules(root: string): boolean {
  return fs.existsSync(path.join(root, 'extensions')) || fs.existsSync(path.join(root, 'modules'));
}

function pickBarducksRootWithFallback(cwd: string, moduleDir: string): string {
  let { barducksRoot } = resolveBarducksRoot({ cwd, moduleDir });
  if (hasExtensionsOrModules(barducksRoot)) return barducksRoot;
  if (hasExtensionsOrModules(cwd)) return cwd;

  const fileBasedRoot = path.resolve(moduleDir, '../..');
  if (hasExtensionsOrModules(fileBasedRoot)) return fileBasedRoot;

  return barducksRoot;
}

/**
 * Returns directories that contain extensions/modules to scan (built-in + workspace repos).
 * This is shared between unified API collection and provider discovery to avoid drift/duplication.
 */
export async function collectExtensionsDirs(args: CollectExtensionsDirsArgs): Promise<string[]> {
  const { cwd, moduleDir, workspaceRoot } = args;

  const barducksRoot = pickBarducksRootWithFallback(cwd, moduleDir);
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

  for (const repoUrl of repos) {
    try {
      // IMPORTANT: no side effects during discovery.
      // Repos should be installed explicitly by installer steps (Step 2),
      // not implicitly by extension discovery.
      const parsed = parseRepoUrl(repoUrl);
      const repoName =
        parsed.type === 'arc'
          ? path.basename(parsed.normalized)
          : parsed.normalized.replace(/^git@/, '').replace(/\.git$/, '').replace(/[:\/]/g, '_');
      const repoRoot = path.join(workspaceRoot, 'barducks', repoName);
      const repoExtensions = path.join(repoRoot, 'extensions');
      if (fs.existsSync(repoExtensions)) dirs.push(repoExtensions);
    } catch (error) {
      if (!args.quiet) {
        const err = error as Error;
        // eslint-disable-next-line no-console
        console.warn(`Warning: Failed to resolve repo extensions dir for ${repoUrl}: ${err.message}`);
      }
    }
  }

  return uniq(dirs);
}

