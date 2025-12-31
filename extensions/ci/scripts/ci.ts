#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createYargs, installEpipeHandler } from '@barducks/sdk';
import { resolveBarducksRoot } from '@barducks/sdk';
import { findWorkspaceRoot } from '@barducks/sdk';
import { readEnvFile } from '@barducks/sdk';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '@barducks/sdk';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider
} from '@barducks/sdk';
import type { CIProvider } from '../schemas/contract.js';
import { ciRouter } from '../api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type WorkspaceConfigLike = {
  extensionSettings?: Record<string, unknown>;
  repos?: string[];
};

function asCIProvider(p: unknown): CIProvider {
  return p as CIProvider;
}

function pickProviderNameFromConfig(workspaceRoot: string | null): string | null {
  const envName = (process.env.CI_PROVIDER || '').trim();
  if (envName) return envName;

  const root = workspaceRoot || findWorkspaceRoot(process.cwd());
  if (!root) return null;

  const configPath = getWorkspaceConfigFilePath(root);
  if (!fs.existsSync(configPath)) return null;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const settings = (cfg && cfg.extensionSettings) || {};
  const ciSettings = (settings as Record<string, unknown>).ci as Record<string, unknown> | undefined;
  const name = ciSettings && typeof ciSettings.provider === 'string' ? ciSettings.provider : '';
  return name.trim() || null;
}

async function initializeProviders(workspaceRoot: string | null): Promise<{
  getProvider: (providerName?: string) => CIProvider | null;
}> {
  const { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });

  // Discover providers from built-in extensions (legacy: modules)
  await discoverProvidersFromModules({ extensionsDir: path.join(barducksRoot, 'extensions') });
  // Discover providers from external repositories
  if (workspaceRoot) {
    const configPath = getWorkspaceConfigFilePath(workspaceRoot);
    if (fs.existsSync(configPath)) {
      const config = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
      if (config && config.repos && Array.isArray(config.repos)) {
        const { loadModulesFromRepo, getBarducksVersion } = await import('../../../src/lib/repo-modules.js');
        const barducksVersion = getBarducksVersion();
        
        for (const repoUrl of config.repos) {
          try {
            const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, barducksVersion);
            if (fs.existsSync(repoModulesPath)) {
              await discoverProvidersFromModules({ extensionsDir: repoModulesPath });
            }
          } catch (error) {
            // Skip failed repos, but log warning
            const err = error as Error;
            console.warn(`Warning: Failed to load providers from ${repoUrl}: ${err.message}`);
          }
        }
      }
    }
  }

  const providers = getProvidersByType('ci');
  if (providers.length === 0) {
    throw new Error('No CI providers discovered');
  }

  return {
    getProvider: (providerName?: string) => {
      const explicit = String(providerName || '').trim();
      const configured = pickProviderNameFromConfig(workspaceRoot);
      const selectedName = explicit || configured || providers[0].name;

      const selected = getProvider('ci', selectedName);
      return selected ? asCIProvider(selected) : asCIProvider(providers[0]);
    }
  };
}

async function main(argv = process.argv): Promise<void> {
  installEpipeHandler();

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  
  // Load environment variables from .env file
  if (workspaceRoot) {
    const envPath = path.join(workspaceRoot, '.env');
    const env = readEnvFile(envPath);
    // Set environment variables from .env (don't override existing ones)
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
  
  const { getProvider: getCIProvider } = await initializeProviders(workspaceRoot);

  // Build yargs with commands generated from router
  const yargsInstance = ciRouter.toCli(
    createYargs(argv)
      .scriptName('ci')
      .strict()
      .usage('Usage: $0 <command> [options]'),
    {
      getProvider: getCIProvider,
      commonOptions: {
        provider: {
          type: 'string',
          describe: 'Provider name (overrides config/env)',
          default: ''
        }
      }
    }
  );

  await yargsInstance
    .demandCommand(1, 'You need at least one command before moving on')
    .help()
    .parseAsync();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    const err = e as { message?: string; stack?: string };
    // eslint-disable-next-line no-console
    console.error(err && err.stack ? err.stack : err.message || String(e));
    process.exitCode = 1;
  });
}

export { main };
