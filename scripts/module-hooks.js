#!/usr/bin/env node

/**
 * Module hooks executor for devduck
 * 
 * Executes hooks defined by modules during workspace installation.
 * Hooks allow modules to define their own installation steps without
 * requiring changes to workspace-installer.js.
 */

const fs = require('fs');
const path = require('path');

/**
 * Load hooks from module
 * @param {string} modulePath - Path to module directory
 * @returns {object|null} - Hooks object or null if not found
 */
function loadModuleHooks(modulePath) {
  const hooksPath = path.join(modulePath, 'hooks.js');
  
  if (!fs.existsSync(hooksPath)) {
    return null;
  }

  try {
    // Clear require cache to allow hot-reloading during development
    delete require.cache[require.resolve(hooksPath)];
    return require(hooksPath);
  } catch (error) {
    console.warn(`Warning: Failed to load hooks from ${hooksPath}: ${error.message}`);
    return null;
  }
}

/**
 * Execute a hook for a module
 * @param {object} module - Module object with path, name, settings
 * @param {string} hookName - Hook name (pre-install, install, test, post-install)
 * @param {object} context - Hook context
 * @returns {Promise<object>} - Hook result
 */
async function executeHook(module, hookName, context) {
  const hooks = loadModuleHooks(module.path);
  
  if (!hooks) {
    // No hooks file - module doesn't define hooks
    return {
      success: true,
      skipped: true,
      message: `No hooks.js found for module ${module.name}`
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
    return {
      success: false,
      errors: [`Hook '${hookName}' failed for module ${module.name}: ${error.message}`],
      stack: error.stack
    };
  }
}

/**
 * Execute hooks for all modules in a stage
 * @param {Array} modules - Array of module objects
 * @param {string} hookName - Hook name to execute
 * @param {Array} contexts - Array of hook contexts (one per module)
 * @returns {Promise<Array>} - Array of results for each module
 */
async function executeHooksForStage(modules, hookName, contexts) {
  const results = [];
  
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
 * @param {string} workspaceRoot - Workspace root directory
 * @param {object} module - Module object
 * @param {Array} allModules - All modules (for post-install)
 * @returns {object} - Hook context
 */
function createHookContext(workspaceRoot, module, allModules = []) {
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

module.exports = {
  loadModuleHooks,
  executeHook,
  executeHooksForStage,
  createHookContext
};
