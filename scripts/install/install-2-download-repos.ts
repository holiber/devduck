#!/usr/bin/env node

import path from 'path';
import { print, symbols } from '../utils.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { RepoResult } from './install-state.js';

export async function installStep2DownloadRepos(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; repos: RepoResult[] }> {
  const { workspaceRoot, config, log } = params;

  print(`\n[Step 2] Download repos...`, 'cyan');
  log(`[step-2] Download repos`);

  const repos = Array.isArray(config.repos) ? config.repos : [];
  if (repos.length === 0) {
    print(`  ${symbols.info} No external repos configured`, 'cyan');
    print(`\n${symbols.success} Step 2 completed`, 'green');
    return { ok: true, repos: [] };
  }

  const { loadModulesFromRepo, getDevduckVersion } = await import('../lib/repo-modules.js');
  const devduckVersion = getDevduckVersion();

  const results: RepoResult[] = [];

  for (const repoUrl of repos) {
    print(`  ${symbols.info} Downloading: ${repoUrl}`, 'cyan');
    try {
      const modulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
      const repoPath = path.dirname(modulesPath);
      results.push({ repoUrl, path: repoPath, ok: true });
      print(`  ${symbols.success} Ready: ${repoPath}`, 'green');
      log(`[step-2] Repo ready: ${repoUrl} -> ${repoPath}`);
    } catch (e) {
      const err = e as Error;
      results.push({ repoUrl, path: '', ok: false, error: err.message });
      print(`  ${symbols.warning} Failed: ${repoUrl} (${err.message})`, 'yellow');
      log(`[step-2] Repo failed: ${repoUrl} (${err.message})`);
    }
  }

  const ok = results.every((r) => r.ok);
  if (!ok) {
    print(`\n${symbols.warning} Step 2 warning: one or more repos failed to download`, 'yellow');
    return { ok: false, repos: results };
  }

  print(`\n${symbols.success} Step 2 completed`, 'green');
  return { ok: true, repos: results };
}

