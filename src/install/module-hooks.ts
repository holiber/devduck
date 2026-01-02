#!/usr/bin/env node

/**
 * Module hooks executor for barducks
 * 
 * Executes hooks defined by modules during workspace installation.
 * Hooks allow modules to define their own installation steps without
 * requiring changes to workspace-installer.js.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '../lib/workspace-config.js';
import { workspace } from '../lib/workspace.js';

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
  barducksRoot?: string;
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

type LoadModuleHooksResult =
  | { status: 'missing' }
  | { status: 'loaded'; hooksPath: string; hooks: ModuleHooks }
  | { status: 'error'; hooksPath: string; error: Error };

type HookEventName = `hook-${string}` | `hook-${string}:${string}`;

function hookEvent(hookName: string, moduleName?: string): HookEventName {
  const base = `hook-${hookName}` as HookEventName;
  if (!moduleName) return base;
  return (`hook-${hookName}:${moduleName}`) as HookEventName;
}

// modulePath -> set of hookNames already registered
const REGISTERED_HOOKS: Map<string, Set<string>> = new Map();

async function ensureHookRegistered(module: { path: string; name: string }, hookName: string): Promise<void> {
  const key = module.path;
  const already = REGISTERED_HOOKS.get(key) || new Set<string>();
  if (already.has(hookName)) return;

  const loaded = await loadModuleHooks(module.path);
  if (loaded.status !== 'loaded') {
    already.add(hookName);
    REGISTERED_HOOKS.set(key, already);
    return;
  }

  const hook = loaded.hooks[hookName];
  if (typeof hook !== 'function') {
    already.add(hookName);
    REGISTERED_HOOKS.set(key, already);
    return;
  }

  // Register both names:
  // - module-specific: hook-pre-install:<moduleName> (used by executor)
  // - generic: hook-pre-install (reserved for future "broadcast stage" use)
  const handler = async (ctx: HookContext): Promise<HookResult | void> => {
    return await hook(ctx);
  };
  workspace.events.on(hookEvent(hookName, module.name), handler);
  workspace.events.on(hookEvent(hookName), handler);

  already.add(hookName);
  REGISTERED_HOOKS.set(key, already);
}

/**
 * Load hooks from module
 * Supports both .js and .ts files
 * @param modulePath - Path to module directory
 * @returns Hooks load result
 */
export async function loadModuleHooks(modulePath: string): Promise<LoadModuleHooksResult> {
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
    return { status: 'missing' };
  }

  try {
    // For .ts files, use dynamic import (tsx should handle them)
    // For .js files, we can use either import or require
    if (hooksPath.endsWith('.ts')) {
      // Use dynamic import for .ts files (tsx loader should handle them)
      const resolvedPath = path.resolve(hooksPath);
      const fileUrl = `file://${resolvedPath}`;
      const hooksModule = await import(fileUrl);
      const hooks = hooksModule.default || hooksModule;
      return { status: 'loaded', hooksPath, hooks: hooks as ModuleHooks };
    } else {
      // For .js files, use require() directly for CommonJS compatibility
      // CommonJS modules (using module.exports) work better with require()
      const require = createRequire(import.meta.url);
      // Clear require cache to allow hot-reloading during development
      const resolvedPath = path.resolve(hooksPath);
      delete require.cache[require.resolve(resolvedPath)];
      const hooksModule = require(resolvedPath);
      // Handle both default export and module.exports
      const hooks = hooksModule.default || hooksModule;
      return { status: 'loaded', hooksPath, hooks: hooks as ModuleHooks };
    }
  } catch (error) {
    const err = error as Error;
    return { status: 'error', hooksPath, error: err };
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
  // Ensure module hook is registered as an event handler (idempotent).
  await ensureHookRegistered({ path: module.path, name: module.name }, hookName);

  const eventName = hookEvent(hookName, module.name);
  const results = await workspace.events.emit(eventName, context);

  if (results.length === 0) {
    return {
      success: true,
      skipped: true,
      message: `Hook '${hookName}' not defined for module ${module.name}`
    };
  }

  // We expect at most one handler per module per hook.
  const first = results[0];
  if (first instanceof Error) {
    return {
      success: false,
      errors: [`Hook '${hookName}' failed for module ${module.name}: ${first.message}`],
      stack: first.stack
    };
  }

  const result = first as HookResult | void;
  if (result && typeof result === 'object') {
    return {
      success: result.success !== false,
      message: result.message,
      createdFiles: result.createdFiles || [],
      errors: result.errors || [],
      ...result
    };
  }

  return { success: true, message: `Hook '${hookName}' executed for module ${module.name}` };
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
  // Resolve barducks root for external modules to use
  // Try to find barducks relative to this file first (for built-in modules)
  let barducksRoot: string | undefined = path.resolve(__dirname, '../..');
  
  // If we're in a workspace, try to find project in projects/barducks
  const workspaceBarducks = path.join(workspaceRoot, 'projects', 'barducks');
  if (fs.existsSync(workspaceBarducks)) {
    barducksRoot = workspaceBarducks;
  } else {
    // Try to find barducks relative to workspace config
    const configPath = getWorkspaceConfigFilePath(workspaceRoot);
    const config = readWorkspaceConfigFile<{ barducks_path?: string }>(configPath);
    const barducksPath = config?.barducks_path;
    if (barducksPath) {
      const resolvedBarducks = path.resolve(workspaceRoot, barducksPath);
      if (fs.existsSync(resolvedBarducks)) barducksRoot = resolvedBarducks;
    }
  }
  
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
    cacheDir: path.join(workspaceRoot, '.cache', 'barducks'),
    cursorDir: path.join(workspaceRoot, '.cursor'),
    commandsDir: path.join(workspaceRoot, '.cursor', 'commands'),
    rulesDir: path.join(workspaceRoot, '.cursor', 'rules'),
    barducksRoot
  };
}

