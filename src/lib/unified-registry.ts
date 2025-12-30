#!/usr/bin/env node

/**
 * Unified registry collector for Barducks modules.
 *
 * Similar to `src/lib/api.ts`, but also attempts to load `spec.ts` from each extension.
 * The registry is a stable source of truth for CLI help and provider requirements.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { ProviderRouter } from './provider-router.js';
import { resolveBarducksRoot } from './barducks-paths.js';
import { findWorkspaceRoot } from './workspace-root.js';
import { readJSON } from './config.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from './workspace-config.js';
import { loadModulesFromRepo, getBarducksVersion } from './repo-modules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ExtensionSpecLike = {
  name?: string;
  description?: string;
  requiresProvider?: boolean;
  providerType?: string;
  tools?: Record<string, unknown>;
  vendorTools?: Record<string, unknown>;
};

export interface UnifiedRegistryEntry {
  moduleName: string;
  modulePath: string | null;
  router: ProviderRouter<any, any>;
  spec: ExtensionSpecLike | null;
  description: string | null;
  requiresProvider: boolean;
  providerType: string | null;
}

export interface UnifiedRegistry {
  [moduleName: string]: UnifiedRegistryEntry;
}

function existsFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function readModuleDescription(modulePath: string): string | null {
  try {
    const moduleMdPath = path.join(modulePath, 'MODULE.md');
    if (!existsFile(moduleMdPath)) return null;
    const content = fs.readFileSync(moduleMdPath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;
    const frontmatter = frontmatterMatch[1];
    const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
    return descriptionMatch ? descriptionMatch[1].trim() : null;
  } catch {
    return null;
  }
}

async function importRouterFromFile(entryPath: string, name: string, quiet: boolean): Promise<ProviderRouter<any, any> | null> {
  try {
    if (!existsFile(entryPath)) return null;
    const moduleExports = await import(pathToFileURL(entryPath).href);
    const routerName = `${name}Router`;
    const router = moduleExports[routerName] || moduleExports.default;
    if (router && typeof router === 'object' && 'call' in router && 'toCli' in router) {
      return router as ProviderRouter<any, any>;
    }
    // Fallback: try any export that looks like a router
    const routerKeys = Object.keys(moduleExports).filter(
      (k) => k.endsWith('Router') || (moduleExports[k] && typeof moduleExports[k] === 'object' && 'call' in moduleExports[k])
    );
    return routerKeys.length > 0 ? (moduleExports[routerKeys[0]] as ProviderRouter<any, any>) : null;
  } catch (error) {
    if (!quiet) {
      const err = error as Error;
      console.warn(`Warning: Failed to import router '${name}' from ${entryPath}: ${err.stack || err.message}`);
    }
    return null;
  }
}

async function importSpecFromModule(modulePath: string, moduleName: string, quiet: boolean): Promise<ExtensionSpecLike | null> {
  try {
    const candidates = [path.join(modulePath, 'spec.ts'), path.join(modulePath, 'spec.js')];
    const specPath = candidates.find((p) => existsFile(p));
    if (!specPath) return null;
    const moduleExports = await import(pathToFileURL(specPath).href);
    const candidate =
      (moduleExports && (moduleExports.default || moduleExports.spec || moduleExports[`${moduleName}Spec`])) as unknown;
    if (!candidate || typeof candidate !== 'object') return null;
    return candidate as ExtensionSpecLike;
  } catch (error) {
    if (!quiet) {
      const err = error as Error;
      console.warn(`Warning: Failed to import spec for ${moduleName} from ${modulePath}: ${err.stack || err.message}`);
    }
    return null;
  }
}

async function discoverModulesFromDirectory(modulesDir: string): Promise<string[]> {
  if (!fs.existsSync(modulesDir)) return [];
  const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  const modules: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modulePath = path.join(modulesDir, entry.name);
    if (existsFile(path.join(modulePath, 'api.ts'))) {
      modules.push(modulePath);
    }
  }
  return modules;
}

async function discoverAPIsFromLibDirectory(libApiDir: string): Promise<string[]> {
  if (!fs.existsSync(libApiDir)) return [];
  const entries = fs.readdirSync(libApiDir, { withFileTypes: true });
  const apiFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts') {
      apiFiles.push(path.join(libApiDir, entry.name));
    }
  }
  return apiFiles;
}

export async function collectUnifiedRegistry(quiet: boolean = false): Promise<UnifiedRegistry> {
  let { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });

  const extensionsDir = path.join(barducksRoot, 'extensions');
  const legacyModulesDir = path.join(barducksRoot, 'modules');
  const mainDir = fs.existsSync(extensionsDir) ? extensionsDir : legacyModulesDir;
  if (!fs.existsSync(mainDir)) {
    const cwdExtensionsDir = path.join(process.cwd(), 'extensions');
    const cwdLegacyModulesDir = path.join(process.cwd(), 'modules');
    if (fs.existsSync(cwdExtensionsDir) || fs.existsSync(cwdLegacyModulesDir)) {
      barducksRoot = process.cwd();
    } else {
      const fileBasedRoot = path.resolve(__dirname, '../..');
      const fileBasedExtensionsDir = path.join(fileBasedRoot, 'extensions');
      const fileBasedLegacyModulesDir = path.join(fileBasedRoot, 'modules');
      if (fs.existsSync(fileBasedExtensionsDir) || fs.existsSync(fileBasedLegacyModulesDir)) {
        barducksRoot = fileBasedRoot;
      }
    }
  }

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  // NOTE: Keep this collector "pure": env loading should happen at the CLI/runtime boundary.
  void workspaceRoot;

  const registry: UnifiedRegistry = {};

  // lib APIs: src/lib/api/*.ts (no extension spec)
  const libApiDir = path.join(__dirname, 'api');
  const apiFiles = await discoverAPIsFromLibDirectory(libApiDir);
  for (const apiPath of apiFiles) {
    const apiName = path.basename(apiPath, '.ts');
    const router = await importRouterFromFile(apiPath, apiName, quiet);
    if (!router) continue;
    registry[apiName] = {
      moduleName: apiName,
      modulePath: null,
      router,
      spec: null,
      description: apiName,
      requiresProvider: false,
      providerType: null
    };
  }

  // extensions/modules from main project directory
  const mainExtensionsDir = fs.existsSync(path.join(barducksRoot, 'extensions'))
    ? path.join(barducksRoot, 'extensions')
    : path.join(barducksRoot, 'modules');
  const mainModules = await discoverModulesFromDirectory(mainExtensionsDir);
  for (const modulePath of mainModules) {
    const moduleName = path.basename(modulePath);
    if (moduleName in registry) continue;
    const router = await importRouterFromFile(path.join(modulePath, 'api.ts'), moduleName, quiet);
    if (!router) continue;
    const spec = await importSpecFromModule(modulePath, moduleName, quiet);
    const description = (spec && spec.description) || readModuleDescription(modulePath) || moduleName;
    const requiresProvider = !!(spec && spec.requiresProvider);
    const providerType = (spec && typeof spec.providerType === 'string' ? spec.providerType : moduleName) || moduleName;
    registry[moduleName] = {
      moduleName,
      modulePath,
      router,
      spec,
      description,
      requiresProvider,
      providerType
    };
  }

  // extensions/modules from external repositories
  if (workspaceRoot) {
    const configPath = getWorkspaceConfigFilePath(workspaceRoot);
    if (existsFile(configPath)) {
      const config =
        readWorkspaceConfigFile<{ repos?: string[] }>(configPath) || readJSON<{ repos?: string[] }>(configPath);

      if (config && config.repos && Array.isArray(config.repos)) {
        const barducksVersion = getBarducksVersion();
        for (const repoUrl of config.repos) {
          try {
            const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, barducksVersion);
            if (!fs.existsSync(repoModulesPath)) continue;
            const repoModules = await discoverModulesFromDirectory(repoModulesPath);
            for (const modulePath of repoModules) {
              const moduleName = path.basename(modulePath);
              if (moduleName in registry) continue;
              const router = await importRouterFromFile(path.join(modulePath, 'api.ts'), moduleName, quiet);
              if (!router) continue;
              const spec = await importSpecFromModule(modulePath, moduleName, quiet);
              const description = (spec && spec.description) || readModuleDescription(modulePath) || moduleName;
              const requiresProvider = !!(spec && spec.requiresProvider);
              const providerType =
                (spec && typeof spec.providerType === 'string' ? spec.providerType : moduleName) || moduleName;
              registry[moduleName] = {
                moduleName,
                modulePath,
                router,
                spec,
                description,
                requiresProvider,
                providerType
              };
            }
          } catch (error) {
            if (!quiet) {
              const err = error as Error;
              console.warn(`Warning: Failed to load modules from ${repoUrl}: ${err.message}`);
            }
          }
        }
      }
    }
  }

  return registry;
}

let cachedRegistry: UnifiedRegistry | null = null;

export async function getUnifiedRegistry(quiet: boolean = false): Promise<UnifiedRegistry> {
  if (!cachedRegistry) {
    cachedRegistry = await collectUnifiedRegistry(quiet);
  }
  return cachedRegistry;
}

