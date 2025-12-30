#!/usr/bin/env node

/**
 * Module resolver for barducks
 * 
 * Resolves module dependencies, handles wildcards, and merges settings.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSIONS_DIR = path.join(__dirname, '..', '..', 'extensions');
const MODULES_DIR = EXTENSIONS_DIR;
const CORE_MODULE_NAME = 'core';
const CURSOR_MODULE_NAME = 'cursor';
const GIT_MODULE_NAME = 'git';

export interface ModuleCheck {
  type: string;
  var?: string;
  name?: string;
  description?: string;
  test?: string;
  [key: string]: unknown;
}

export interface ModuleMetadata {
  name?: string;
  version?: string;
  description?: string;
  tags?: string[];
  dependencies?: string[];
  defaultSettings?: Record<string, unknown>;
  checks?: ModuleCheck[];
  mcpSettings?: Record<string, unknown>;
}

export interface Module {
  name: string;
  version: string;
  description: string;
  tags: string[];
  dependencies: string[];
  defaultSettings: Record<string, unknown>;
  checks?: ModuleCheck[];
  mcpSettings?: Record<string, unknown>;
  path: string;
}

/**
 * Parse YAML frontmatter from MODULE.md
 */
function parseModuleFrontmatter(modulePath: string): ModuleMetadata | null {
  const moduleMdPath = path.join(modulePath, 'MODULE.md');
  if (!fs.existsSync(moduleMdPath)) {
    return null;
  }

  const content = fs.readFileSync(moduleMdPath, 'utf8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const yamlContent = frontmatterMatch[1];
  
  try {
    const parsed = parseYaml(yamlContent) as Record<string, unknown>;
    
    // Convert to ModuleMetadata format
    const metadata: ModuleMetadata = {
      name: parsed.name as string | undefined,
      version: parsed.version as string | undefined,
      description: parsed.description as string | undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags as string[] : undefined,
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies as string[] : undefined,
      defaultSettings: parsed.defaultSettings as Record<string, unknown> | undefined,
      checks: Array.isArray(parsed.checks) ? parsed.checks as ModuleCheck[] : undefined,
      mcpSettings: parsed.mcpSettings as Record<string, unknown> | undefined
    };
    
    return metadata;
  } catch (error) {
    // If parsing fails, return null
    const err = error as Error;
    console.warn(`Warning: Failed to parse YAML frontmatter for module at ${modulePath}: ${err.message}`);
    return null;
  }
}

/**
 * Load module metadata
 */
export function loadModule(moduleName: string): Module | null {
  const modulePath = path.join(MODULES_DIR, moduleName);
  if (!fs.existsSync(modulePath)) {
    return null;
  }

  const metadata = parseModuleFrontmatter(modulePath);
  if (!metadata) {
    return null;
  }

  return {
    name: metadata.name || moduleName,
    version: metadata.version || '0.1.0',
    description: metadata.description || '',
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : [],
    defaultSettings: metadata.defaultSettings || {},
    checks: metadata.checks || [],
    mcpSettings: metadata.mcpSettings,
    path: modulePath
  };
}

/**
 * Load module metadata from an explicit module path (not necessarily under MODULES_DIR)
 */
export function loadModuleFromPath(modulePath: string, fallbackName: string | null = null): Module | null {
  if (!modulePath || typeof modulePath !== 'string') {
    return null;
  }
  if (!fs.existsSync(modulePath)) {
    return null;
  }

  const metadata = parseModuleFrontmatter(modulePath);
  if (!metadata) {
    return null;
  }

  const moduleDirName = fallbackName || path.basename(modulePath);
  return {
    name: metadata.name || moduleDirName,
    version: metadata.version || '0.1.0',
    description: metadata.description || '',
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : [],
    defaultSettings: metadata.defaultSettings || {},
    checks: metadata.checks || [],
    mcpSettings: metadata.mcpSettings,
    path: modulePath
  };
}

/**
 * Get all available modules
 */
export function getAllModules(): Module[] {
  if (!fs.existsSync(MODULES_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(MODULES_DIR, { withFileTypes: true });
  const modules: Module[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const module = loadModule(entry.name);
      if (module) {
        modules.push(module);
      }
    }
  }

  return modules;
}

/**
 * Get all available modules from a specific modules directory
 */
export function getAllModulesFromDirectory(modulesDir: string): Module[] {
  if (!modulesDir || typeof modulesDir !== 'string') {
    return [];
  }
  if (!fs.existsSync(modulesDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const modules: Module[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modulePath = path.join(modulesDir, entry.name);
    const module = loadModuleFromPath(modulePath, entry.name);
    if (module) {
      modules.push(module);
    }
  }

  return modules;
}

/**
 * Resolve module dependencies
 */
export function resolveDependencies(moduleNames: string[], allModules: Module[]): Module[] {
  const resolved = new Set<string>();
  const toResolve = [...moduleNames];
  
  // Build module map first to check what exists
  const moduleMap = new Map<string, Module>();
  for (const module of allModules) {
    // Resolution priority: the *first* occurrence wins.
    // The caller is expected to pass `allModules` ordered by priority:
    // 1) workspace modules, 2) project modules, 3) barducks modules.
    if (!moduleMap.has(module.name)) {
      moduleMap.set(module.name, module);
    }
  }
  
  // Always include core module (if it exists)
  if (!toResolve.includes(CORE_MODULE_NAME) && moduleMap.has(CORE_MODULE_NAME)) {
    toResolve.push(CORE_MODULE_NAME);
  }
  
  // Always include git module (essential for Git integration)
  // Note: git depends on core, but we include it explicitly because
  // it's an essential module for generating .gitignore
  if (!toResolve.includes(GIT_MODULE_NAME) && moduleMap.has(GIT_MODULE_NAME)) {
    toResolve.push(GIT_MODULE_NAME);
  }

  while (toResolve.length > 0) {
    const moduleName = toResolve.shift();
    if (!moduleName) continue;
    
    if (resolved.has(moduleName)) {
      continue;
    }

    const module = moduleMap.get(moduleName);
    if (!module) {
      // Suppress warning for 'core' module as it's optional and may not have MODULE.md
      if (moduleName !== CORE_MODULE_NAME) {
        console.warn(`Warning: Module '${moduleName}' not found`);
      }
      continue;
    }

    resolved.add(moduleName);

    // Add dependencies
    for (const dep of module.dependencies) {
      if (!resolved.has(dep)) {
        toResolve.push(dep);
      }
    }
  }

  return Array.from(resolved).map(name => moduleMap.get(name)).filter((m): m is Module => m !== undefined);
}

export interface WorkspaceConfig {
  extensions?: string[];
  extensionSettings?: Record<string, Record<string, unknown>>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPattern(s: string): boolean {
  return s.includes('*') || s.includes('?');
}

/**
 * Expand workspace module selectors into explicit module names.
 *
 * Supported selectors:
 * - "*" (all modules)
 * - "prefix-*" (simple glob with `*` / `?`)
 * - exact module names
 */
export function expandModuleNames(selectors: string[], allModules: Module[]): string[] {
  const allNames = allModules.map((m) => m.name);

  if (selectors.includes('*')) {
    return allNames;
  }

  const out: string[] = [];
  const seen = new Set<string>();

  for (const sel of selectors) {
    if (typeof sel !== 'string' || sel.trim() === '') continue;
    const s = sel.trim();

    if (!isPattern(s)) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
      continue;
    }

    const re = new RegExp(`^${escapeRegExp(s).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`);
    for (const name of allNames) {
      if (re.test(name) && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }

  return out;
}

/**
 * Resolve modules from workspace config
 */
export function resolveModules(workspaceConfig: WorkspaceConfig, allModules: Module[]): Module[] {
  const moduleNames = expandModuleNames(workspaceConfig.extensions || ['*'], allModules);

  // Filter by tags if needed (future feature)
  // For now, just resolve by name

  return resolveDependencies(moduleNames, allModules);
}

/**
 * Merge extension settings
 */
export function mergeModuleSettings(
  module: Module,
  workspaceModuleSettings?: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const defaultSettings = module.defaultSettings || {};
  const workspaceSettings = workspaceModuleSettings?.[module.name] || {};
  
  // Deep merge
  const merged = { ...defaultSettings };
  for (const [key, value] of Object.entries(workspaceSettings)) {
    if (typeof value === 'object' && !Array.isArray(value) && value !== null && typeof merged[key] === 'object' && !Array.isArray(merged[key]) && merged[key] !== null) {
      merged[key] = { ...(merged[key] as Record<string, unknown>), ...value };
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export {
  EXTENSIONS_DIR,
  MODULES_DIR,
  CORE_MODULE_NAME,
  CURSOR_MODULE_NAME,
  GIT_MODULE_NAME
};

