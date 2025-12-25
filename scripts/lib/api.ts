#!/usr/bin/env node

/**
 * Unified API collector for DevDuck modules
 * 
 * Discovers all installed modules with api.ts files and collects their routers
 * into a unified API structure.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ProviderRouter } from './provider-router.js';
import { resolveDevduckRoot } from './devduck-paths.js';
import { findWorkspaceRoot } from './workspace-root.js';
import { readJSON } from './config.js';
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
async function importRouterFromModule(modulePath: string, moduleName: string): Promise<ProviderRouter<any, any> | null> {
  try {
    const apiPath = path.join(modulePath, 'api.ts');
    
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
    // Silently skip modules that fail to import
    const err = error as Error;
    console.warn(`Warning: Failed to import router from ${moduleName}: ${err.message}`);
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
 * Collect unified API from all installed modules
 */
export async function collectUnifiedAPI(): Promise<UnifiedAPI> {
  const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });
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
  
  // Discover modules from main devduck modules directory
  const mainModulesDir = path.join(devduckRoot, 'modules');
  const mainModules = await discoverModulesFromDirectory(mainModulesDir);
  
  for (const modulePath of mainModules) {
    const moduleName = path.basename(modulePath);
    const router = await importRouterFromModule(modulePath, moduleName);
    
    if (router) {
      unifiedAPI[moduleName] = router;
    }
  }
  
  // Discover modules from external repositories
  if (workspaceRoot) {
    const configPath = path.join(workspaceRoot, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      const config = readJSON<{ repos?: string[] }>(configPath);
      
      if (config && config.repos && Array.isArray(config.repos)) {
        const devduckVersion = getDevduckVersion();
        
        for (const repoUrl of config.repos) {
          try {
            const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
            if (fs.existsSync(repoModulesPath)) {
              const repoModules = await discoverModulesFromDirectory(repoModulesPath);
              
              for (const modulePath of repoModules) {
                const moduleName = path.basename(modulePath);
                
                // Skip if already added from main modules
                if (moduleName in unifiedAPI) {
                  continue;
                }
                
                const router = await importRouterFromModule(modulePath, moduleName);
                
                if (router) {
                  unifiedAPI[moduleName] = router;
                }
              }
            }
          } catch (error) {
            // Skip failed repos, but log warning
            const err = error as Error;
            console.warn(`Warning: Failed to load modules from ${repoUrl}: ${err.message}`);
          }
        }
      }
    }
  }
  
  return unifiedAPI;
}

/**
 * Get unified API (cached version - collects on first call)
 */
let cachedAPI: UnifiedAPI | null = null;

export async function getUnifiedAPI(): Promise<UnifiedAPI> {
  if (!cachedAPI) {
    cachedAPI = await collectUnifiedAPI();
  }
  return cachedAPI;
}
