#!/usr/bin/env node

/**
 * Unified API collector for Barducks modules
 * 
 * Discovers APIs from scripts/lib/api/ directory and all installed modules with api.ts files,
 * then collects their routers into a unified API structure.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ProviderRouter } from './provider-router.js';
import { findWorkspaceRoot } from './workspace-root.js';
import { readEnvFile } from './env.js';
import { collectExtensionsDirs } from './extensions-discovery.js';
import { createRouterFromExtensionFactory } from './extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unified API structure - maps module names to their routers
 */
export interface UnifiedAPI {
  [moduleName: string]: ProviderRouter<any, any>;
}

export type ExtensionSpecLike = {
  name?: string;
  description?: string;
  requiresProvider?: boolean;
  providerType?: string;
  tools?: Record<string, unknown>;
  vendorTools?: Record<string, unknown>;
};

export interface UnifiedAPIEntry {
  moduleName: string;
  modulePath: string | null;
  router: ProviderRouter<any, any>;
  spec: ExtensionSpecLike | null;
  description: string | null;
  requiresProvider: boolean;
  providerType: string | null;
}

export interface UnifiedAPIEntries {
  [moduleName: string]: UnifiedAPIEntry;
}

/**
 * Discover modules from a directory
 */
async function discoverModulesFromDirectory(modulesDir: string): Promise<string[]> {
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  const modules: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const modulePath = path.join(modulesDir, entry.name);
      const apiPath = path.join(modulePath, 'api.ts');
      
      if (fs.existsSync(apiPath)) {
        modules.push(modulePath);
      }
    }
  }

  return modules;
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
    const pkgJsonPath = path.join(modulePath, 'package.json');
    if (existsFile(pkgJsonPath)) {
      try {
        const raw = fs.readFileSync(pkgJsonPath, 'utf8');
        const pkg = JSON.parse(raw) as { description?: unknown };
        if (typeof pkg?.description === 'string' && pkg.description.trim().length > 0) {
          return pkg.description.trim();
        }
      } catch {
        // ignore JSON parse errors and fall back to MODULE.md
      }
    }

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

/**
 * Import router from a module's api.ts file
 */
async function importRouterFromModule(
  modulePath: string,
  moduleName: string,
  workspace: Record<string, unknown>,
  quiet: boolean = false
): Promise<ProviderRouter<any, any> | null> {
  try {
    const apiPath = path.join(modulePath, 'api.ts');
    
    // Check if api.ts file exists
    if (!fs.existsSync(apiPath)) {
      return null;
    }
    
    // Try to import the module
    // We expect exports like: ciRouter, emailRouter, etc.
    const moduleUrl = pathToFileURL(apiPath).href;
    const moduleExports = await import(moduleUrl);

    // New-style extension definition (factory function).
    if (typeof moduleExports?.default === 'function') {
      return createRouterFromExtensionFactory({
        moduleName,
        factory: moduleExports.default,
        workspace
      });
    }
    
    // Try common router export patterns
    const routerName = `${moduleName}Router`;
    const router = moduleExports[routerName] || moduleExports.default;
    
    if (!router) {
      // Try to find any router export
      const routerKeys = Object.keys(moduleExports).filter(key => 
        key.endsWith('Router') || 
        (moduleExports[key] && typeof moduleExports[key] === 'object' && 'call' in moduleExports[key])
      );
      
      if (routerKeys.length > 0) {
        return moduleExports[routerKeys[0]];
      }
      
      return null;
    }
    
    // Verify it's a router (has call and toCli methods)
    if (router && typeof router === 'object' && 'call' in router && 'toCli' in router) {
      return router;
    }
    
    return null;
  } catch (error) {
    // Log error with more details for debugging (only if not in quiet mode)
    if (!quiet) {
      const err = error as Error;
      const errorDetails = err.stack || err.message;
      console.warn(`Warning: Failed to import router from ${moduleName} (${modulePath}): ${errorDetails}`);
    }
    return null;
  }
}

/**
 * Convert file path to file:// URL
 */
function pathToFileURL(filePath: string): URL {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/');
  return new URL(`file://${normalized}`);
}

/**
 * Discover API files from scripts/lib/api/ directory
 */
async function discoverAPIsFromLibDirectory(libApiDir: string): Promise<string[]> {
  if (!fs.existsSync(libApiDir)) {
    return [];
  }

  const entries = fs.readdirSync(libApiDir, { withFileTypes: true });
  const apiFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts') {
      const apiPath = path.join(libApiDir, entry.name);
      apiFiles.push(apiPath);
    }
  }

  return apiFiles;
}

/**
 * Import router from an API file in scripts/lib/api/
 */
async function importRouterFromAPI(
  apiPath: string,
  apiName: string,
  workspace: Record<string, unknown>,
  quiet: boolean = false
): Promise<ProviderRouter<any, any> | null> {
  try {
    // Check if API file exists
    if (!fs.existsSync(apiPath)) {
      return null;
    }
    
    // Try to import the module
    const moduleUrl = pathToFileURL(apiPath).href;
    const moduleExports = await import(moduleUrl);

    // New-style extension definition (factory function).
    if (typeof moduleExports?.default === 'function') {
      return createRouterFromExtensionFactory({
        moduleName: apiName,
        factory: moduleExports.default,
        workspace
      });
    }
    
    // Try common router export patterns
    const routerName = `${apiName}Router`;
    const router = moduleExports[routerName] || moduleExports.default;
    
    if (!router) {
      // Try to find any router export
      const routerKeys = Object.keys(moduleExports).filter(key => 
        key.endsWith('Router') || 
        (moduleExports[key] && typeof moduleExports[key] === 'object' && 'call' in moduleExports[key])
      );
      
      if (routerKeys.length > 0) {
        return moduleExports[routerKeys[0]];
      }
      
      return null;
    }
    
    // Verify it's a router (has call and toCli methods)
    if (router && typeof router === 'object' && 'call' in router && 'toCli' in router) {
      return router;
    }
    
    return null;
  } catch (error) {
    // Log error with more details for debugging (only if not in quiet mode)
    if (!quiet) {
      const err = error as Error;
      const errorDetails = err.stack || err.message;
      console.warn(`Warning: Failed to import router from ${apiName} (${apiPath}): ${errorDetails}`);
    }
    return null;
  }
}

/**
 * Collect unified API from all installed modules
 * @param quiet - If true, suppress warnings and side effects
 */
export async function collectUnifiedAPI(quiet: boolean = false): Promise<UnifiedAPI> {
  const entries = await collectUnifiedAPIEntries({ quiet });
  const unifiedAPI: UnifiedAPI = {};
  for (const [name, entry] of Object.entries(entries)) {
    unifiedAPI[name] = entry.router;
  }
  return unifiedAPI;
}

export async function collectUnifiedAPIEntries(args?: {
  quiet?: boolean;
}): Promise<UnifiedAPIEntries> {
  const quiet = !!args?.quiet;

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const workspace: Record<string, unknown> = { workspaceRoot };
  
  // Load environment variables from .env file in workspace root
  // This ensures env vars are available when modules are imported
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
  
  const out: UnifiedAPIEntries = {};
  
  // First, load APIs from scripts/lib/api/ directory
  const libApiDir = path.join(__dirname, 'api');
  const apiFiles = await discoverAPIsFromLibDirectory(libApiDir);
  
  for (const apiPath of apiFiles) {
    const apiName = path.basename(apiPath, '.ts');
    const router = await importRouterFromAPI(apiPath, apiName, workspace, quiet);
    
    if (router) {
      out[apiName] = {
        moduleName: apiName,
        modulePath: null,
        router,
        spec: null,
        description: apiName,
        requiresProvider: false,
        providerType: null
      };
    }
  }
  
  const extensionDirs = await collectExtensionsDirs({
    cwd: process.cwd(),
    moduleDir: __dirname,
    workspaceRoot,
    includeLegacyModulesDir: true,
    quiet
  });

  for (const extensionsDir of extensionDirs) {
    const modules = await discoverModulesFromDirectory(extensionsDir);
    for (const modulePath of modules) {
      const moduleName = path.basename(modulePath);
      if (moduleName in out) continue;
      const router = await importRouterFromModule(modulePath, moduleName, workspace, quiet);
      if (!router) continue;
      const spec = await importSpecFromModule(modulePath, moduleName, quiet);
      const description = (spec && spec.description) || readModuleDescription(modulePath) || moduleName;
      const requiresProvider = !!(spec && spec.requiresProvider);
      const providerType = (spec && typeof spec.providerType === 'string' ? spec.providerType : moduleName) || moduleName;

      out[moduleName] = {
        moduleName,
        modulePath,
        router,
        spec,
        description,
        requiresProvider,
        providerType
      };
    }
  }

  return out;
}

/**
 * Get unified API (cached version - collects on first call)
 * @param quiet - If true, suppress warnings and side effects
 */
let cachedAPI: UnifiedAPI | null = null;

export async function getUnifiedAPI(quiet: boolean = false): Promise<UnifiedAPI> {
  if (!cachedAPI) {
    cachedAPI = await collectUnifiedAPI(quiet);
  }
  return cachedAPI;
}

let cachedEntries: UnifiedAPIEntries | null = null;

export async function getUnifiedAPIEntries(args?: { quiet?: boolean }): Promise<UnifiedAPIEntries> {
  if (!cachedEntries) {
    cachedEntries = await collectUnifiedAPIEntries(args);
  }
  return cachedEntries;
}
