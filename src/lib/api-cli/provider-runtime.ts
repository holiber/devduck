import fs from 'fs';
import path from 'path';

import { resolveBarducksRoot } from '../barducks-paths.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '../workspace-config.js';
import { discoverProvidersFromModules, getProvider, getProvidersByType, type ProviderBase } from '../provider-registry.js';
import { loadModulesFromRepo, getBarducksVersion } from '../repo-modules.js';

type WorkspaceConfigLike = {
  extensionSettings?: Record<string, unknown>;
  repos?: string[];
};

function pickProviderNameFromConfig(moduleName: string, workspaceRoot: string | null): string | null {
  const envVarName = `${moduleName.toUpperCase()}_PROVIDER`;
  const envName = (process.env[envVarName] || '').trim();
  if (envName) return envName;

  if (!workspaceRoot) return null;
  const configPath = getWorkspaceConfigFilePath(workspaceRoot);
  if (!fs.existsSync(configPath)) return null;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const settings = (cfg && cfg.extensionSettings) || {};
  const settingsObj = settings as Record<string, unknown>;
  const moduleConfig = settingsObj[moduleName] as Record<string, unknown> | undefined;
  const name = moduleConfig && typeof moduleConfig.provider === 'string' ? moduleConfig.provider : '';
  return name.trim() || null;
}

export async function ensureProvidersDiscovered(workspaceRoot: string | null, moduleDir: string): Promise<void> {
  const { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir });
  await discoverProvidersFromModules({ extensionsDir: path.join(barducksRoot, 'extensions') });

  // Discover providers from external repositories (workspace.config.yml -> repos)
  if (!workspaceRoot) return;
  const configPath = getWorkspaceConfigFilePath(workspaceRoot);
  if (!fs.existsSync(configPath)) return;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const repos = (cfg && Array.isArray(cfg.repos) ? cfg.repos : []) || [];
  if (repos.length === 0) return;

  const barducksVersion = getBarducksVersion();
  for (const repoUrl of repos) {
    try {
      const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, barducksVersion);
      if (fs.existsSync(repoModulesPath)) {
        await discoverProvidersFromModules({ extensionsDir: repoModulesPath });
      }
    } catch (error) {
      const err = error as Error;
      console.warn(`Warning: Failed to load providers from ${repoUrl}: ${err.message}`);
    }
  }
}

export function createProviderGetter(args: {
  moduleName: string;
  workspaceRoot: string | null;
  providerType: string;
}): { getProvider: (providerName?: string) => ProviderBase | null; providers: ProviderBase[] } {
  const { moduleName, workspaceRoot, providerType } = args;
  const providers = getProvidersByType(providerType);

  return {
    providers,
    getProvider: (providerName?: string) => {
      const explicit = String(providerName || '').trim();
      const configured = pickProviderNameFromConfig(moduleName, workspaceRoot);
      const selectedName = explicit || configured || (providers.length > 0 ? providers[0].name : null);
      if (!selectedName) return null;
      return (getProvider(providerType, selectedName) as ProviderBase | null) || (providers.length > 0 ? providers[0] : null);
    }
  };
}

