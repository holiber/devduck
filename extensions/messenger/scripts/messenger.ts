#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createYargs, installEpipeHandler } from '../../../src/lib/cli.js';
import { resolveBarducksRoot } from '../../../src/lib/barducks-paths.js';
import { findWorkspaceRoot } from '../../../src/lib/workspace-root.js';
import { readEnvFile } from '../../../src/lib/env.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '../../../src/lib/workspace-config.js';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider
} from '../../../src/lib/provider-registry.js';

import type { MessengerProvider } from '../schemas/contract.js';
import { messengerRouter } from '../api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkspaceConfigLike = {
  extensionSettings?: Record<string, unknown>;
  repos?: string[];
};

function asMessengerProvider(p: unknown): MessengerProvider {
  return p as MessengerProvider;
}

function pickProviderNameFromConfig(workspaceRoot: string | null): string | null {
  const envName = (process.env.MESSENGER_PROVIDER || '').trim();
  if (envName) return envName;

  const root = workspaceRoot || findWorkspaceRoot(process.cwd());
  if (!root) return null;

  const configPath = getWorkspaceConfigFilePath(root);
  if (!fs.existsSync(configPath)) return null;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const settings = (cfg && cfg.extensionSettings) || {};
  const messengerSettings = (settings as Record<string, unknown>).messenger as Record<string, unknown> | undefined;
  const name = messengerSettings && typeof messengerSettings.provider === 'string' ? messengerSettings.provider : '';
  return name.trim() || null;
}

async function initializeProviders(workspaceRoot: string | null): Promise<{
  getProvider: (providerName?: string) => MessengerProvider | null;
}> {
  const { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });

  // Discover providers from barducks modules
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
            const err = error as Error;
            // eslint-disable-next-line no-console
            console.warn(`Warning: Failed to load providers from ${repoUrl}: ${err.message}`);
          }
        }
      }
    }
  }

  const providers = getProvidersByType('messenger');
  if (providers.length === 0) {
    throw new Error('No messenger providers discovered');
  }

  return {
    getProvider: (providerName?: string) => {
      const explicit = String(providerName || '').trim();
      const configured = pickProviderNameFromConfig(workspaceRoot);
      const selectedName = explicit || configured || providers[0].name;
      const selected = getProvider('messenger', selectedName);
      return selected ? asMessengerProvider(selected) : asMessengerProvider(providers[0]);
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
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) process.env[key] = value;
    }
  }

  const { getProvider: getMessengerProvider } = await initializeProviders(workspaceRoot);

  const yargsInstance = messengerRouter.toCli(
    createYargs(argv).scriptName('messenger').strict().usage('Usage: $0 <command> [options]'),
    {
      getProvider: getMessengerProvider,
      commonOptions: {
        provider: {
          type: 'string',
          describe: 'Provider name (overrides config/env)',
          default: ''
        }
      }
    }
  );

  await yargsInstance.demandCommand(1, 'You need at least one command before moving on').help().parseAsync();
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

