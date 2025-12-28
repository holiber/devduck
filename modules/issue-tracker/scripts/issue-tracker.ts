#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createYargs, installEpipeHandler } from '../../../scripts/lib/cli.js';
import { resolveDevduckRoot } from '../../../scripts/lib/devduck-paths.js';
import { findWorkspaceRoot } from '../../../scripts/lib/workspace-root.js';
import { readEnvFile } from '../../../scripts/lib/env.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '../../../scripts/lib/workspace-config.js';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider
} from '../../../scripts/lib/provider-registry.js';
import type { IssueTrackerProvider } from '../schemas/contract.js';
import { issueTrackerRouter } from '../api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type WorkspaceConfigLike = {
  moduleSettings?: Record<string, unknown>;
  repos?: string[];
};

function asIssueTrackerProvider(p: unknown): IssueTrackerProvider {
  return p as IssueTrackerProvider;
}

function pickProviderNameFromConfig(workspaceRoot: string | null): string | null {
  const envName = (process.env.ISSUE_TRACKER_PROVIDER || '').trim();
  if (envName) return envName;

  const root = workspaceRoot || findWorkspaceRoot(process.cwd());
  if (!root) return null;

  const configPath = getWorkspaceConfigFilePath(root);
  if (!fs.existsSync(configPath)) return null;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const moduleSettings = (cfg && cfg.moduleSettings) || {};
  const issueTrackerSettings = (moduleSettings as Record<string, unknown>).issueTracker as
    | Record<string, unknown>
    | undefined;
  const name = issueTrackerSettings && typeof issueTrackerSettings.provider === 'string' ? issueTrackerSettings.provider : '';
  return name.trim() || null;
}

async function initializeProviders(workspaceRoot: string | null): Promise<{
  getProvider: (providerName?: string) => IssueTrackerProvider | null;
}> {
  const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });

  // Discover providers from devduck modules
  await discoverProvidersFromModules({ modulesDir: path.join(devduckRoot, 'modules') });

  // Discover providers from external repositories
  if (workspaceRoot) {
    const configPath = getWorkspaceConfigFilePath(workspaceRoot);
    if (fs.existsSync(configPath)) {
      const config = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
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

  const providers = getProvidersByType('issue-tracker');
  if (providers.length === 0) {
    throw new Error('No issue tracker providers discovered');
  }

  return {
    getProvider: (providerName?: string) => {
      const explicit = String(providerName || '').trim();
      const configured = pickProviderNameFromConfig(workspaceRoot);
      const selectedName = explicit || configured || providers[0].name;

      const selected = getProvider('issue-tracker', selectedName);
      return selected ? asIssueTrackerProvider(selected) : asIssueTrackerProvider(providers[0]);
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
  
  const { getProvider: getIssueTrackerProvider } = await initializeProviders(workspaceRoot);

  // Build yargs with commands generated from router
  const yargsInstance = issueTrackerRouter.toCli(
    createYargs(argv)
      .scriptName('issue-tracker')
      .strict()
      .usage('Usage: $0 <command> [options]'),
    {
      getProvider: getIssueTrackerProvider,
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

