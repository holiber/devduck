#!/usr/bin/env node

/**
 * Unified API collector for DevDuck modules
 * 
 * Discovers APIs from scripts/lib/api/ directory and all installed modules with api.ts files,
 * then collects their routers into a unified API structure.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ProviderRouter } from './provider-router.js';
import { resolveDevduckRoot } from './devduck-paths.js';
import { findWorkspaceRoot } from './workspace-root.js';
import { readJSON } from './config.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from './workspace-config.js';
import { readEnvFile } from './env.js';
import { loadModulesFromRepo, getDevduckVersion } from './repo-modules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Unified API structure - maps module names to their routers
 */
export interface UnifiedAPI {
  [moduleName: string]: ProviderRouter<any, any>;
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

/**
 * Import router from a module's api.ts file
 */
async function importRouterFromModule(modulePath: string, moduleName: string, quiet: boolean = false): Promise<ProviderRouter<any, any> | null> {
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
async function importRouterFromAPI(apiPath: string, apiName: string, quiet: boolean = false): Promise<ProviderRouter<any, any> | null> {
  try {
    // Check if API file exists
    if (!fs.existsSync(apiPath)) {
      return null;
    }
    
    // Try to import the module
    const moduleUrl = pathToFileURL(apiPath).href;
    const moduleExports = await import(moduleUrl);
    
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
  // Try to resolve devduck root - in CI, we might be running from the repo root
  let { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });
  
  // Verify that devduckRoot actually contains modules directory
  // If not, try to resolve from current working directory (for CI environments)
  const modulesDir = path.join(devduckRoot, 'modules');
  if (!fs.existsSync(modulesDir)) {
    // In CI, we might be in the repo root, so try that
    const cwdModulesDir = path.join(process.cwd(), 'modules');
    if (fs.existsSync(cwdModulesDir)) {
      devduckRoot = process.cwd();
    } else {
      // Last resort: try to find modules relative to this file
      const fileBasedRoot = path.resolve(__dirname, '../..');
      const fileBasedModulesDir = path.join(fileBasedRoot, 'modules');
      if (fs.existsSync(fileBasedModulesDir)) {
        devduckRoot = fileBasedRoot;
      }
    }
  }
  
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  
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
  
  const unifiedAPI: UnifiedAPI = {};
  
  // First, load APIs from scripts/lib/api/ directory
  const libApiDir = path.join(__dirname, 'api');
  const apiFiles = await discoverAPIsFromLibDirectory(libApiDir);
  
  for (const apiPath of apiFiles) {
    const apiName = path.basename(apiPath, '.ts');
    const router = await importRouterFromAPI(apiPath, apiName, quiet);
    
    if (router) {
      unifiedAPI[apiName] = router;
    }
  }
  
  // Then, discover modules from main devduck modules directory
  const mainModulesDir = path.join(devduckRoot, 'modules');
  const mainModules = await discoverModulesFromDirectory(mainModulesDir);
  
  for (const modulePath of mainModules) {
    const moduleName = path.basename(modulePath);
    
    // Skip if already added from lib APIs
    if (moduleName in unifiedAPI) {
      continue;
    }
    
    const router = await importRouterFromModule(modulePath, moduleName, quiet);
    
    if (router) {
      unifiedAPI[moduleName] = router;
    }
  }
  
  // Discover modules from external repositories
  if (workspaceRoot) {
    const configPath = getWorkspaceConfigFilePath(workspaceRoot);
    if (fs.existsSync(configPath)) {
      const config = readWorkspaceConfigFile<{ repos?: string[] }>(configPath) || readJSON<{ repos?: string[] }>(configPath);
      
      if (config && config.repos && Array.isArray(config.repos)) {
        const devduckVersion = getDevduckVersion();
        
        for (const repoUrl of config.repos) {
          try {
            const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
            if (fs.existsSync(repoModulesPath)) {
              const repoModules = await discoverModulesFromDirectory(repoModulesPath);
              
              for (const modulePath of repoModules) {
                const moduleName = path.basename(modulePath);
                
                // Skip if already added from lib APIs or main modules
                if (moduleName in unifiedAPI) {
                  continue;
                }
                
                const router = await importRouterFromModule(modulePath, moduleName, quiet);
                
                if (router) {
                  unifiedAPI[moduleName] = router;
                }
              }
            }
          } catch (error) {
            // Skip failed repos, but log warning (only if not in quiet mode)
            if (!quiet) {
              const err = error as Error;
              console.warn(`Warning: Failed to load modules from ${repoUrl}: ${err.message}`);
            }
          }
        }
      }
    }
  }
  
  return unifiedAPI;
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
