#!/usr/bin/env node

/**
 * Module hooks executor for devduck
 * 
 * Executes hooks defined by modules during workspace installation.
 * Hooks allow modules to define their own installation steps without
 * requiring changes to workspace-installer.js.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface HookContext {
  workspaceRoot: string;
  modulePath: string;
  moduleName: string;
  settings: Record<string, unknown>;
  allModules: Array<{
    name: string;
    path: string;
    settings?: Record<string, unknown>;
  }>;
  cacheDir: string;
  cursorDir: string;
  commandsDir: string;
  rulesDir: string;
}

export interface HookResult {
  success: boolean;
  skipped?: boolean;
  message?: string;
  createdFiles?: string[];
  errors?: string[];
  stack?: string;
}

export interface ModuleHooks {
  'pre-install'?: (context: HookContext) => Promise<HookResult | void> | HookResult | void;
  'install'?: (context: HookContext) => Promise<HookResult | void> | HookResult | void;
  'test'?: (context: HookContext) => Promise<HookResult | void> | HookResult | void;
  'post-install'?: (context: HookContext) => Promise<HookResult | void> | HookResult | void;
  [key: string]: ((context: HookContext) => Promise<HookResult | void> | HookResult | void) | undefined;
}

/**
 * Load hooks from module
 * Supports both .js and .ts files
 * @param modulePath - Path to module directory
 * @returns Hooks object or null if not found
 */
export async function loadModuleHooks(modulePath: string): Promise<ModuleHooks | null> {
  // Try .ts first (for TypeScript modules)
  const hooksTsPath = path.join(modulePath, 'hooks.ts');
  const hooksJsPath = path.join(modulePath, 'hooks.js');
  
  let hooksPath: string | null = null;
  if (fs.existsSync(hooksTsPath)) {
    hooksPath = hooksTsPath;
  } else if (fs.existsSync(hooksJsPath)) {
    hooksPath = hooksJsPath;
  }
  
  if (!hooksPath) {
    return null;
  }

  try {
    // Use dynamic import for ES modules (works with both .ts via tsx and .js)
    // Convert file path to file:// URL for import
    const fileUrl = hooksPath.startsWith('/') 
      ? `file://${hooksPath}`
      : `file://${path.resolve(hooksPath)}`;
    
    const hooksModule = await import(fileUrl);
    
    // Handle both default export and named exports
    const hooks = hooksModule.default || hooksModule;
    
    return hooks as ModuleHooks;
  } catch (error) {
    const err = error as Error;
    console.warn(`Warning: Failed to load hooks from ${hooksPath}: ${err.message}`);
    return null;
  }
}

/**
 * Execute a hook for a module
 * @param module - Module object with path, name, settings
 * @param hookName - Hook name (pre-install, install, test, post-install)
 * @param context - Hook context
 * @returns Hook result
 */
export async function executeHook(
  module: { path: string; name: string; settings?: Record<string, unknown> },
  hookName: string,
  context: HookContext
): Promise<HookResult> {
  const hooks = await loadModuleHooks(module.path);
  
  if (!hooks) {
    // No hooks file - module doesn't define hooks
    return {
      success: true,
      skipped: true,
      message: `No hooks.ts/hooks.js found for module ${module.name}`
    };
  }

  const hook = hooks[hookName];
  
  if (!hook) {
    // Hook not defined - not an error, just skip
    return {
      success: true,
      skipped: true,
      message: `Hook '${hookName}' not defined for module ${module.name}`
    };
  }

  if (typeof hook !== 'function') {
    return {
      success: false,
      errors: [`Hook '${hookName}' in module ${module.name} is not a function`]
    };
  }

  try {
    const result = await hook(context);
    
    // Validate result
    if (result && typeof result === 'object') {
      return {
        success: result.success !== false, // Default to true if not specified
        message: result.message,
        createdFiles: result.createdFiles || [],
        errors: result.errors || [],
        ...result
      };
    }
    
    // If hook returns non-object, assume success
    return {
      success: true,
      message: `Hook '${hookName}' executed for module ${module.name}`
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      errors: [`Hook '${hookName}' failed for module ${module.name}: ${err.message}`],
      stack: err.stack
    };
  }
}

/**
 * Execute hooks for all modules in a stage
 * @param modules - Array of module objects
 * @param hookName - Hook name to execute
 * @param contexts - Array of hook contexts (one per module)
 * @returns Array of results for each module
 */
export async function executeHooksForStage(
  modules: Array<{ path: string; name: string; settings?: Record<string, unknown> }>,
  hookName: string,
  contexts: HookContext[]
): Promise<Array<HookResult & { module: string; hook: string }>> {
  const results: Array<HookResult & { module: string; hook: string }> = [];
  
  for (let i = 0; i < modules.length; i++) {
    const module = modules[i];
    const context = contexts[i];
    const result = await executeHook(module, hookName, context);
    results.push({
      module: module.name,
      hook: hookName,
      ...result
    });
  }
  
  return results;
}

/**
 * Create hook context object
 * @param workspaceRoot - Workspace root directory
 * @param module - Module object
 * @param allModules - All modules (for post-install)
 * @returns Hook context
 */
export function createHookContext(
  workspaceRoot: string,
  module: { path: string; name: string; settings?: Record<string, unknown> },
  allModules: Array<{ name: string; path: string; settings?: Record<string, unknown> }> = []
): HookContext {
  return {
    workspaceRoot,
    modulePath: module.path,
    moduleName: module.name,
    settings: module.settings || {},
    allModules: allModules.map(m => ({
      name: m.name,
      path: m.path,
      settings: m.settings
    })),
    cacheDir: path.join(workspaceRoot, '.cache', 'devduck'),
    cursorDir: path.join(workspaceRoot, '.cursor'),
    commandsDir: path.join(workspaceRoot, '.cursor', 'commands'),
    rulesDir: path.join(workspaceRoot, '.cursor', 'rules')
  };
}

