import fs from 'fs';

import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '../workspace-config.js';
import { discoverProvidersFromModules, getProvider, getProvidersByType, type ProviderBase } from '../providers-registry.js';
import { collectExtensionsDirs } from '../extensions-discovery.js';

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

export async function ensureProvidersDiscovered(
  workspaceRoot: string | null,
  moduleDir: string,
  quiet: boolean = false
): Promise<void> {
  const dirs = await collectExtensionsDirs({
    cwd: process.cwd(),
    moduleDir,
    workspaceRoot,
    includeLegacyModulesDir: true,
    quiet
  });

  for (const d of dirs) {
    await discoverProvidersFromModules({ extensionsDir: d });
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

