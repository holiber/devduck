#!/usr/bin/env node

/**
 * Module resolver for devduck
 * 
 * Resolves module dependencies, handles wildcards, and merges settings.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const CORE_MODULE_NAME = 'core';
const CURSOR_MODULE_NAME = 'cursor';
const GIT_MODULE_NAME = 'git';

export interface ModuleMetadata {
  name?: string;
  version?: string;
  description?: string;
  tags?: string[];
  dependencies?: string[];
  defaultSettings?: Record<string, unknown>;
}

export interface Module {
  name: string;
  version: string;
  description: string;
  tags: string[];
  dependencies: string[];
  defaultSettings: Record<string, unknown>;
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
  const metadata: ModuleMetadata = {};
  const lines = yamlContent.split('\n');
  
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let inMultiline = false;
  let inDefaultSettings = false;
  let currentSettingKey: string | null = null;
  let currentSettingValue: string[] = [];
  let inSettingMultiline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.match(/^(\s*)/)?.[1].length || 0;

    // Skip empty lines when not in multiline
    if (trimmed === '' && !inMultiline && !inSettingMultiline) {
      continue;
    }

    // Check if we're entering defaultSettings block
    if (trimmed === 'defaultSettings:' && indent === 0) {
      inDefaultSettings = true;
      metadata.defaultSettings = {};
      continue;
    }

    // Check if we're leaving defaultSettings (next top-level key)
    if (inDefaultSettings && indent === 0 && trimmed.includes(':') && !trimmed.startsWith(' ')) {
      // Save last setting
      if (currentSettingKey && currentSettingValue.length > 0) {
        if (!metadata.defaultSettings) metadata.defaultSettings = {};
        metadata.defaultSettings[currentSettingKey] = currentSettingValue.join('\n').trim();
      }
      inDefaultSettings = false;
      currentSettingKey = null;
      currentSettingValue = [];
      inSettingMultiline = false;
    }

    // Handle defaultSettings nested keys
    if (inDefaultSettings) {
      // Check for multiline setting (key: |)
      const multilineMatch = trimmed.match(/^(\w+):\s*\|/);
      if (multilineMatch) {
        // Save previous setting
        if (currentSettingKey && currentSettingValue.length > 0) {
          if (!metadata.defaultSettings) metadata.defaultSettings = {};
          metadata.defaultSettings[currentSettingKey] = currentSettingValue.join('\n').trim();
        }
        currentSettingKey = multilineMatch[1];
        currentSettingValue = [];
        inSettingMultiline = true;
        continue;
      }

      // Check for end of multiline setting
      if (inSettingMultiline) {
        if (trimmed === '' && currentSettingValue.length > 0 && (i === lines.length - 1 || lines[i + 1].trim() === '' || !lines[i + 1].match(/^\s/))) {
          if (!metadata.defaultSettings) metadata.defaultSettings = {};
          if (currentSettingKey) {
            metadata.defaultSettings[currentSettingKey] = currentSettingValue.join('\n').trim();
          }
          currentSettingKey = null;
          currentSettingValue = [];
          inSettingMultiline = false;
          continue;
        }
        // Remove 4-space indentation from multiline content
        const dedented = line.replace(/^\s{4}/, '');
        currentSettingValue.push(dedented);
        continue;
      }

      // Regular key: value in defaultSettings (shouldn't happen with our format, but handle it)
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0 && indent === 2) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        if (!metadata.defaultSettings) metadata.defaultSettings = {};
        metadata.defaultSettings[key] = value.replace(/^["']|["']$/g, '');
      }
      continue;
    }

    // Handle top-level keys
    // Check for multiline value (key: |)
    const multilineMatch = trimmed.match(/^(\w+):\s*\|/);
    if (multilineMatch) {
      // Save previous key
      if (currentKey && currentValue.length > 0) {
        (metadata as Record<string, unknown>)[currentKey] = currentValue.join('\n').trim();
      }
      currentKey = multilineMatch[1];
      currentValue = [];
      inMultiline = true;
      continue;
    }

    // Check for end of multiline value
    if (inMultiline) {
      if (trimmed === '' && currentValue.length > 0 && (i === lines.length - 1 || lines[i + 1].trim() === '' || !lines[i + 1].match(/^\s/))) {
        if (currentKey) {
          (metadata as Record<string, unknown>)[currentKey] = currentValue.join('\n').trim();
        }
        currentKey = null;
        currentValue = [];
        inMultiline = false;
        continue;
      }
      // Remove 2-space indentation from multiline content
      const dedented = line.replace(/^\s{2}/, '');
      currentValue.push(dedented);
      continue;
    }

    // Regular key: value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0 && indent === 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      
      // Handle array values [item1, item2]
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        (metadata as Record<string, unknown>)[key] = arrayContent.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      } else {
        (metadata as Record<string, unknown>)[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  }

  // Save last values
  if (currentKey && currentValue.length > 0) {
    (metadata as Record<string, unknown>)[currentKey] = currentValue.join('\n').trim();
  }
  if (currentSettingKey && currentSettingValue.length > 0) {
    if (!metadata.defaultSettings) metadata.defaultSettings = {};
    metadata.defaultSettings[currentSettingKey] = currentSettingValue.join('\n').trim();
  }

  return metadata;
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
  
  // Always include core module
  if (!toResolve.includes(CORE_MODULE_NAME)) {
    toResolve.push(CORE_MODULE_NAME);
  }
  
  // Always include cursor module (for Cursor IDE integration)
  // Note: cursor depends on core, but we include it explicitly because
  // it's a required module for devduck to work in Cursor IDE
  if (!toResolve.includes(CURSOR_MODULE_NAME)) {
    toResolve.push(CURSOR_MODULE_NAME);
  }
  
  // Always include git module (essential for Git integration)
  // Note: git depends on core, but we include it explicitly because
  // it's an essential module for generating .gitignore
  if (!toResolve.includes(GIT_MODULE_NAME)) {
    toResolve.push(GIT_MODULE_NAME);
  }

  const moduleMap = new Map<string, Module>();
  for (const module of allModules) {
    moduleMap.set(module.name, module);
  }

  while (toResolve.length > 0) {
    const moduleName = toResolve.shift();
    if (!moduleName) continue;
    
    if (resolved.has(moduleName)) {
      continue;
    }

    const module = moduleMap.get(moduleName);
    if (!module) {
      console.warn(`Warning: Module '${moduleName}' not found`);
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
  modules?: string[];
  moduleSettings?: Record<string, Record<string, unknown>>;
}

/**
 * Resolve modules from workspace config
 */
export function resolveModules(workspaceConfig: WorkspaceConfig, allModules: Module[]): Module[] {
  let moduleNames = workspaceConfig.modules || ['*'];

  // Handle wildcard
  if (moduleNames.includes('*')) {
    moduleNames = allModules.map(m => m.name);
  }

  // Filter by tags if needed (future feature)
  // For now, just resolve by name

  return resolveDependencies(moduleNames, allModules);
}

/**
 * Merge module settings
 */
export function mergeModuleSettings(module: Module, workspaceModuleSettings?: Record<string, Record<string, unknown>>): Record<string, unknown> {
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
  MODULES_DIR,
  CORE_MODULE_NAME,
  CURSOR_MODULE_NAME,
  GIT_MODULE_NAME
};

