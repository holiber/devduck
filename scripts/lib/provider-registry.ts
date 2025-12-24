import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { z } from 'zod';

export type ProviderType = string;
export type ProviderName = string;

export interface ProviderManifestBase {
  type: ProviderType;
  name: ProviderName;
  version: string;
  protocolVersion: string;
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
}

export interface DiscoverProvidersOptions {
  modulesDir: string;
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

async function importProviderFromFile(entryPath: string): Promise<ProviderBase> {
  const mod = await import(pathToFileURL(entryPath).href);
  const candidate = (mod && (mod.default || mod.provider || mod)) as unknown;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Provider entry '${entryPath}' did not export a provider object (default/provider)`);
  }
  return candidate as ProviderBase;
}

/**
 * Discover providers by scanning modules directory.
 *
 * Supported layouts:
 * - Provider inside a module:
 *   modules/<module>/providers/<provider-name>/{PROVIDER.md,index.ts|js}
 * - Provider as a standalone provider module:
 *   modules/<module>/{PROVIDER.md,index.ts|js}
 */
export async function discoverProvidersFromModules(opts: DiscoverProvidersOptions): Promise<DiscoveredProvider[]> {
  const modulesDir = opts.modulesDir;
  const discovered: DiscoveredProvider[] = [];

  if (!modulesDir || typeof modulesDir !== 'string') return discovered;
  if (!fs.existsSync(modulesDir)) return discovered;

  const moduleEntries = fs.readdirSync(modulesDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of moduleEntries) {
    const modulePath = path.join(modulesDir, entry.name);

    // Standalone provider module: modules/<module>/PROVIDER.md + index.(ts|js)
    const providerMd = path.join(modulePath, 'PROVIDER.md');
    if (existsFile(providerMd)) {
      const entryPath = tryResolveEntrypoint(modulePath, 'index');
      if (entryPath) {
        const provider = await importProviderFromFile(entryPath);
        discovered.push({ provider, entryPath });
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

      const provider = await importProviderFromFile(entryPath);
      discovered.push({ provider, entryPath });
    }
  }

  // Register everything discovered. This happens after scanning to allow all imports to succeed
  // even if registration ordering matters for some providers.
  for (const item of discovered) {
    registerProvider(item.provider.name, item.provider);
  }

  return discovered;
}

