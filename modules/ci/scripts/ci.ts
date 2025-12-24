#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createYargs, installEpipeHandler } from '../../../scripts/lib/cli.js';
import { readJSON } from '../../../scripts/lib/config.js';
import { resolveDevduckRoot } from '../../../scripts/lib/devduck-paths.js';
import { findWorkspaceRoot } from '../../../scripts/lib/workspace-root.js';
import { readEnvFile } from '../../../scripts/lib/env.js';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider,
  setProviderTypeSchema
} from '../../../scripts/lib/provider-registry.js';
import { generateProviderCommandsFromContract } from '../../../scripts/lib/provider-cli-utils.js';
import type { CIProvider, CIToolName } from '../schemas/contract.js';
import {
  CIProviderSchema,
  CIToolNameSchema,
  CIToolInputSchemas,
  CIToolDescriptions
} from '../schemas/contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type WorkspaceConfigLike = {
  moduleSettings?: Record<string, unknown>;
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

  const configPath = path.join(root, 'workspace.config.json');
  if (!fs.existsSync(configPath)) return null;

  const cfg = readJSON<WorkspaceConfigLike>(configPath);
  const moduleSettings = (cfg && cfg.moduleSettings) || {};
  const ciSettings = (moduleSettings as Record<string, unknown>).ci as Record<string, unknown> | undefined;
  const name = ciSettings && typeof ciSettings.provider === 'string' ? ciSettings.provider : '';
  return name.trim() || null;
}

async function initializeProviders(workspaceRoot: string | null): Promise<{
  getProvider: (providerName?: string) => CIProvider | null;
}> {
  const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });

  setProviderTypeSchema('ci', CIProviderSchema);

  // Discover providers from devduck modules
  await discoverProvidersFromModules({ modulesDir: path.join(devduckRoot, 'modules') });

  // Discover providers from external repositories
  if (workspaceRoot) {
    const configPath = path.join(workspaceRoot, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      const config = readJSON<WorkspaceConfigLike>(configPath);
      if (config && config.repos && Array.isArray(config.repos)) {
        const { loadModulesFromRepo, getDevduckVersion } = await import('../../../scripts/lib/repo-modules.js');
        const devduckVersion = getDevduckVersion();
        
        for (const repoUrl of config.repos) {
          try {
            const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
            if (fs.existsSync(repoModulesPath)) {
              await discoverProvidersFromModules({ modulesDir: repoModulesPath });
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

/**
 * Get all available tool names from contract
 */
function getAvailableTools(): CIToolName[] {
  // Extract enum values from CIToolNameSchema
  const enumDef = CIToolNameSchema._def;
  return enumDef.values as CIToolName[];
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

  // Generate commands from contract automatically
  const commands = generateProviderCommandsFromContract<CIProvider, CIToolName>({
    contract: {
      toolNames: getAvailableTools(),
      inputSchemas: CIToolInputSchemas,
      descriptions: CIToolDescriptions
    },
    commonOptions: {
      provider: {
        type: 'string',
        describe: 'Provider name (overrides config/env)',
        default: ''
      }
    },
    getProvider: getCIProvider
  });

  // Build yargs with generated commands
  let yargsInstance = createYargs(argv)
    .scriptName('ci')
    .strict()
    .usage('Usage: $0 <command> [options]');

  for (const command of commands) {
    yargsInstance = yargsInstance.command(command);
  }

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
