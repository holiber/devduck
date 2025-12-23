#!/usr/bin/env node

/**
 * Module loader for devduck
 * 
 * Loads modules and collects their scripts, commands, rules, apps, and agents.
 */

const fs = require('fs');
const path = require('path');
const { loadModule, getAllModules, resolveModules, mergeModuleSettings, MODULES_DIR } = require('./module-resolver');
const { loadModuleHooks } = require('./module-hooks');

/**
 * Collect files from module directory
 */
function collectModuleFiles(modulePath, subdir) {
  const dirPath = path.join(modulePath, subdir);
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = [];
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
 * Load module resources
 */
function loadModuleResources(module) {
  return {
    name: module.name,
    version: module.version,
    description: module.description,
    tags: module.tags,
    dependencies: module.dependencies,
    defaultSettings: module.defaultSettings,
    path: module.path,
    scripts: collectModuleFiles(module.path, 'scripts'),
    commands: collectModuleFiles(module.path, 'commands'),
    rules: collectModuleFiles(module.path, 'rules'),
    apps: collectModuleFiles(module.path, 'apps'),
    agents: collectModuleFiles(module.path, 'agents'),
    mcpConfig: loadMcpConfig(module.path),
    hasHooks: loadModuleHooks(module.path) !== null
  };
}

/**
 * Load MCP config from module
 */
function loadMcpConfig(modulePath) {
  const mcpPath = path.join(modulePath, 'mcp.json');
  if (!fs.existsSync(mcpPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  } catch (e) {
    console.warn(`Warning: Failed to parse mcp.json for module at ${modulePath}: ${e.message}`);
    return null;
  }
}

/**
 * Load all modules for workspace
 */
function loadModulesForWorkspace(workspaceConfig) {
  const allModules = getAllModules();
  const resolvedModules = resolveModules(workspaceConfig, allModules);
  
  const loadedModules = resolvedModules.map(module => {
    const resources = loadModuleResources(module);
    const mergedSettings = mergeModuleSettings(module, workspaceConfig.moduleSettings);
    
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
function getModuleByName(moduleName) {
  const module = loadModule(moduleName);
  if (!module) {
    return null;
  }
  return loadModuleResources(module);
}

/**
 * Resolve module path for require
 */
function resolveModulePath(moduleName, relativePath = '') {
  const modulePath = path.join(MODULES_DIR, moduleName);
  if (!fs.existsSync(modulePath)) {
    return null;
  }
  
  if (relativePath) {
    return path.join(modulePath, relativePath);
  }
  
  return modulePath;
}

module.exports = {
  loadModuleResources,
  loadModulesForWorkspace,
  getModuleByName,
  resolveModulePath,
  collectModuleFiles,
  loadMcpConfig
};
