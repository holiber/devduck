import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { z } from 'zod';
import { workspace as WORKSPACE_SINGLETON } from './workspace.js';

export type ProviderType = string;
export type ProviderName = string;

export interface ProviderManifestBase {
  type: ProviderType;
  name: ProviderName;
  version: string;
  tools: string[];
  // Keep permissive: providers may add more metadata.
  [key: string]: unknown;
}

export interface ProviderBase {
  name: ProviderName;
  version: string;
  manifest: ProviderManifestBase;
  // Provider-specific methods (tools) are not typed here.
  [key: string]: unknown;
}

type ProviderTypeSchema = z.ZodTypeAny;

const providersByType: Map<ProviderType, Map<ProviderName, ProviderBase>> = new Map();
const schemasByType: Map<ProviderType, ProviderTypeSchema> = new Map();

function ensureTypeMap(type: ProviderType): Map<ProviderName, ProviderBase> {
  const existing = providersByType.get(type);
  if (existing) return existing;
  const next = new Map<ProviderName, ProviderBase>();
  providersByType.set(type, next);
  return next;
}

export function setProviderTypeSchema(type: ProviderType, schema: ProviderTypeSchema): void {
  schemasByType.set(type, schema);
}

export function registerProvider(name: ProviderName, provider: ProviderBase): void {
  if (!provider || typeof provider !== 'object') {
    throw new Error(`registerProvider(${name}): provider must be an object`);
  }
  if (!provider.manifest || typeof provider.manifest !== 'object') {
    throw new Error(`registerProvider(${name}): provider.manifest is required`);
  }
  const type = String((provider.manifest as ProviderManifestBase).type || '').trim();
  if (!type) {
    throw new Error(`registerProvider(${name}): provider.manifest.type is required`);
  }
  const providerName = String(name || provider.name || provider.manifest.name || '').trim();
  if (!providerName) {
    throw new Error(`registerProvider(${name}): provider name is required`);
  }

  const schema = schemasByType.get(type);
  if (schema) {
    // Validate provider object against its contract schema (best-effort).
    // We intentionally throw on mismatch to avoid silently registering broken providers.
    const res = schema.safeParse(provider);
    if (!res.success) {
      throw new Error(
        `Provider '${providerName}' (type '${type}') failed contract validation: ${res.error.message}`
      );
    }
  }

  const typeMap = ensureTypeMap(type);
  typeMap.set(providerName, provider);
}

export function getProvider(type: ProviderType, name: ProviderName): ProviderBase | null {
  const typeMap = providersByType.get(type);
  if (!typeMap) return null;
  return typeMap.get(name) || null;
}

export function getProvidersByType(type: ProviderType): ProviderBase[] {
  const typeMap = providersByType.get(type);
  if (!typeMap) return [];
  return Array.from(typeMap.values());
}

export function getAllProviders(): Array<{ type: ProviderType; name: ProviderName; provider: ProviderBase }> {
  const out: Array<{ type: ProviderType; name: ProviderName; provider: ProviderBase }> = [];
  for (const [type, typeMap] of providersByType.entries()) {
    for (const [name, provider] of typeMap.entries()) {
      out.push({ type, name, provider });
    }
  }
  return out;
}

export function clearProvidersForTests(): void {
  providersByType.clear();
  schemasByType.clear();

  // Also clear provider resource instances so activate()-based discovery stays deterministic in tests.
  for (const [rid, inst] of WORKSPACE_SINGLETON.resources.instances.entries()) {
    if ((inst as any).resourceType === 'provider') {
      WORKSPACE_SINGLETON.resources.instances.delete(rid);
    }
  }
}

export interface DiscoverProvidersOptions {
  extensionsDir: string;
}

export interface DiscoveredProvider {
  provider: ProviderBase;
  entryPath: string;
}

function existsFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function tryResolveEntrypoint(dir: string, baseName: string): string | null {
  const candidates = [
    path.join(dir, `${baseName}.js`),
    path.join(dir, `${baseName}.ts`),
    path.join(dir, `${baseName}.mjs`),
    path.join(dir, `${baseName}.cjs`)
  ];
  for (const c of candidates) {
    if (existsFile(c)) return c;
  }
  return null;
}

type ProviderActivateFn = (workspace: unknown, ext: unknown) => unknown | Promise<unknown>;

type ImportedProviderModule = {
  activate?: ProviderActivateFn;
  provider?: unknown;
  default?: unknown;
  [key: string]: unknown;
};

async function importProviderFromFile(entryPath: string): Promise<ImportedProviderModule> {
  const mod = await import(pathToFileURL(entryPath).href);
  return (mod || {}) as ImportedProviderModule;
}

/**
 * Discover providers by scanning extensions directory (legacy: modules directory).
 *
 * Supported layouts:
 * - Provider inside an extension:
 *   extensions/<extension>/providers/<provider-name>/{PROVIDER.md,index.ts|js}
 * - Provider as a standalone provider extension:
 *   extensions/<extension>/{PROVIDER.md,index.ts|js}
 */
export async function discoverProvidersFromModules(opts: DiscoverProvidersOptions): Promise<DiscoveredProvider[]> {
  const modulesDir = String(opts.extensionsDir || '').trim();
  const discovered: DiscoveredProvider[] = [];

  if (!modulesDir || typeof modulesDir !== 'string') return discovered;
  if (!fs.existsSync(modulesDir)) return discovered;

  const moduleEntries = fs.readdirSync(modulesDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of moduleEntries) {
    const modulePath = path.join(modulesDir, entry.name);

    // Standalone provider module: extensions/<module>/PROVIDER.md + index.(ts|js)
    const providerMd = path.join(modulePath, 'PROVIDER.md');
    if (existsFile(providerMd)) {
      const entryPath = tryResolveEntrypoint(modulePath, 'index');
      if (entryPath) {
        const mod = await importProviderFromFile(entryPath);
        discovered.push(...(await registerProvidersFromImportedModule(mod, entryPath)));
      }
    }

    // Provider inside a module: modules/<module>/providers/<provider>/*
    const providersDir = path.join(modulePath, 'providers');
    if (!fs.existsSync(providersDir)) continue;

    const providerDirs = fs.readdirSync(providersDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const pDir of providerDirs) {
      const pPath = path.join(providersDir, pDir.name);
      const pMd = path.join(pPath, 'PROVIDER.md');
      if (!existsFile(pMd)) continue;
      const entryPath = tryResolveEntrypoint(pPath, 'index');
      if (!entryPath) continue;

      const mod = await importProviderFromFile(entryPath);
      discovered.push(...(await registerProvidersFromImportedModule(mod, entryPath)));
    }
  }

  return discovered;
}

// ---- activate(...) entrypoint runtime ----

export type DefineProviderInput = {
  type: ProviderType;
  name: string;
  version: string;
  description?: string;
  auth?: unknown;
  api: Record<string, (input: any) => Promise<any> | any>;
};

export type Extension = {
  defineProvider: (def: DefineProviderInput) => ProviderBase;
};

function ensureProviderResourceTypeRegistered(): void {
  // Register provider resource type if missing.
  const types = WORKSPACE_SINGLETON.resources.types;
  if (!types.has('provider')) {
    WORKSPACE_SINGLETON.resources.registerResourceType({
      resourceType: 'provider',
      id: 'provider',
      instanceCount: 'multiple',
      title: 'Provider',
      description: 'Workspace provider instance'
    });
  }
}

function createExtensionRuntime(entryPath: string): Extension {
  return {
    defineProvider: (def: DefineProviderInput) => {
      const type = String(def?.type || '').trim();
      const name = String(def?.name || '').trim();
      const version = String(def?.version || '').trim();
      if (!type) throw new Error(`defineProvider(${entryPath}): type is required`);
      if (!name) throw new Error(`defineProvider(${entryPath}): name is required`);
      if (!version) throw new Error(`defineProvider(${entryPath}): version is required`);

      const api = (def.api || {}) as Record<string, any>;
      const tools = Object.keys(api);
      if (tools.length === 0) throw new Error(`defineProvider(${entryPath}): api must have at least one tool`);

      const provider: ProviderBase = {
        name,
        version,
        manifest: {
          type,
          name,
          version,
          description: def.description,
          tools,
          events: { publish: [], subscribe: [] },
          auth: def.auth ?? { type: 'none', requiredTokens: [] }
        },
        api
      };

      // Register in in-memory registry (for API runtime) and in workspace resources (for discovery/introspection).
      registerProvider(name, provider);

      ensureProviderResourceTypeRegistered();
      WORKSPACE_SINGLETON.resources.registerResourceInstance({
        resourceId: `provider:${type}:${name}`,
        resourceType: 'provider',
        resourceSubType: type,
        id: name,
        title: name,
        version,
        root: entryPath,
        instance: provider
      });

      return provider;
    }
  };
}

async function registerProvidersFromImportedModule(mod: ImportedProviderModule, entryPath: string): Promise<DiscoveredProvider[]> {
  // New style: activate(workspace, ext)
  if (typeof mod.activate === 'function') {
    const ext = createExtensionRuntime(entryPath);
    await mod.activate(WORKSPACE_SINGLETON, ext);

    // Best-effort: return all providers registered from this entryPath via workspace resources.
    const out: DiscoveredProvider[] = [];
    for (const inst of WORKSPACE_SINGLETON.resources.instances.values()) {
      if (inst.resourceType !== 'provider') continue;
      if (String(inst.root || '') !== entryPath) continue;
      const p = (inst as any).instance as ProviderBase | undefined;
      if (p) out.push({ provider: p, entryPath });
    }
    return out;
  }

  // Legacy style: default export provider object
  const candidate = (mod && (mod.default || mod.provider || mod)) as unknown;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Provider entry '${entryPath}' did not export an activate() function or provider object (default/provider)`);
  }
  const provider = candidate as ProviderBase;
  registerProvider(provider.name, provider);
  return [{ provider, entryPath }];
}

