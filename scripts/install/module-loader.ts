#!/usr/bin/env node

/**
 * Module loader for devduck
 * 
 * Loads modules and collects their scripts, commands, rules, apps, and agents.
 */

import fs from 'fs';
import path from 'path';
import {
  loadModule,
  getAllModules,
  resolveModules,
  mergeModuleSettings,
  MODULES_DIR,
  type Module,
  type WorkspaceConfig
} from './module-resolver.js';

export interface ModuleFile {
  name: string;
  path: string;
}

export interface ModuleResource extends Module {
  scripts: ModuleFile[];
  commands: ModuleFile[];
  rules: ModuleFile[];
  apps: ModuleFile[];
  agents: ModuleFile[];
  mcpConfig: Record<string, unknown> | null;
  hasHooks: boolean;
  settings?: Record<string, unknown>;
}

/**
 * Collect files from module directory
 */
export function collectModuleFiles(modulePath: string, subdir: string): ModuleFile[] {
  const dirPath = path.join(modulePath, subdir);
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files: ModuleFile[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      files.push({
        name: entry.name,
        path: path.join(dirPath, entry.name)
      });
    } else if (entry.isDirectory()) {
      // Recursively collect files from subdirectories
      const subFiles = collectModuleFiles(modulePath, path.join(subdir, entry.name));
      files.push(...subFiles);
    }
  }

  return files;
}

/**
 * Check if module has hooks file
 */
function hasModuleHooks(modulePath: string): boolean {
  const hooksTsPath = path.join(modulePath, 'hooks.ts');
  const hooksJsPath = path.join(modulePath, 'hooks.js');
  return fs.existsSync(hooksTsPath) || fs.existsSync(hooksJsPath);
}

/**
 * Load module resources
 */
export function loadModuleResources(module: Module): ModuleResource {
  return {
    name: module.name,
    version: module.version,
    description: module.description,
    tags: module.tags,
    dependencies: module.dependencies,
    defaultSettings: module.defaultSettings,
    checks: module.checks,
    mcpSettings: module.mcpSettings,
    path: module.path,
    scripts: collectModuleFiles(module.path, 'scripts'),
    commands: collectModuleFiles(module.path, 'commands'),
    rules: collectModuleFiles(module.path, 'rules'),
    apps: collectModuleFiles(module.path, 'apps'),
    agents: collectModuleFiles(module.path, 'agents'),
    mcpConfig: loadMcpConfig(module.path),
    hasHooks: hasModuleHooks(module.path)
  };
}

/**
 * Load MCP config from module
 */
export function loadMcpConfig(modulePath: string): Record<string, unknown> | null {
  const mcpPath = path.join(modulePath, 'mcp.json');
  if (!fs.existsSync(mcpPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    const error = e as Error;
    console.warn(`Warning: Failed to parse mcp.json for module at ${modulePath}: ${error.message}`);
    return null;
  }
}

/**
 * Load all modules for workspace
 */
export function loadModulesForWorkspace(workspaceConfig: WorkspaceConfig): ModuleResource[] {
  const allModules = getAllModules();
  const resolvedModules = resolveModules(workspaceConfig, allModules);
  
  const loadedModules = resolvedModules.map(module => {
    const resources = loadModuleResources(module);
    const settings =
      (workspaceConfig.extensionSettings as Record<string, Record<string, unknown>> | undefined) ??
      (workspaceConfig.moduleSettings as Record<string, Record<string, unknown>> | undefined);
    const mergedSettings = mergeModuleSettings(module, settings);
    
    return {
      ...resources,
      settings: mergedSettings
    };
  });

  return loadedModules;
}

/**
 * Get module by name
 */
export function getModuleByName(moduleName: string): ModuleResource | null {
  const module = loadModule(moduleName);
  if (!module) {
    return null;
  }
  return loadModuleResources(module);
}

/**
 * Resolve module path for require
 */
export function resolveModulePath(moduleName: string, relativePath = ''): string | null {
  const modulePath = path.join(MODULES_DIR, moduleName);
  if (!fs.existsSync(modulePath)) {
    return null;
  }
  
  if (relativePath) {
    return path.join(modulePath, relativePath);
  }
  
  return modulePath;
}

