#!/usr/bin/env node

/**
 * Test helpers for workspace installer tests
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INSTALLER_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'install.js');

/**
 * Create a temporary directory for testing
 * @returns {Promise<string>} Path to temporary directory
 */
async function createTempWorkspace() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devduck-test-'));
  return tmpDir;
}

/**
 * Clean up temporary workspace
 * @param {string} workspacePath - Path to workspace to clean up
 */
async function cleanupTempWorkspace(workspacePath) {
  if (!workspacePath || !workspacePath.includes('devduck-test-')) {
    throw new Error('Safety check: Only cleaning up test directories');
  }
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors during cleanup
    console.warn(`Warning: Failed to cleanup ${workspacePath}: ${error.message}`);
  }
}

/**
 * Execute installer with given options
 * @param {string} workspacePath - Path to workspace
 * @param {object} options - Installer options
 * @param {boolean} options.unattended - Run in unattended mode
 * @param {string} options.config - Path to config file
 * @param {object} options.inputs - Mock inputs for interactive mode (array of strings)
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runInstaller(workspacePath, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ['--workspace-path', workspacePath];
    
    if (options.unattended) {
      args.push('--unattended');
    }
    
    if (options.config) {
      args.push('--config', options.config);
    }
    
    if (options.aiAgent) {
      args.push('--ai-agent', options.aiAgent);
    }
    
    if (options.repoType) {
      args.push('--repo-type', options.repoType);
    }
    
    if (options.modules) {
      args.push('--modules', Array.isArray(options.modules) ? options.modules.join(',') : options.modules);
    }
    
    if (options.skipRepoInit) {
      args.push('--skip-repo-init');
    }

    let stdout = '';
    let stderr = '';
    let inputBuffer = '';
    let inputIndex = 0;
    
    const proc = spawn('node', [INSTALLER_SCRIPT, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Handle inputs for interactive mode
    if (options.inputs && options.inputs.length > 0) {
      proc.stdin.setEncoding('utf8');
      
      // Send inputs with delays to simulate user interaction
      const sendInput = () => {
        if (inputIndex < options.inputs.length) {
          setTimeout(() => {
            proc.stdin.write(options.inputs[inputIndex] + '\n');
            inputIndex++;
            if (inputIndex < options.inputs.length) {
              sendInput();
            } else {
              proc.stdin.end();
            }
          }, 100);
        }
      };
      
      // Wait a bit before sending first input
      setTimeout(sendInput, 200);
    } else if (options.unattended) {
      proc.stdin.end();
    }

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code
      });
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Verify workspace structure
 * @param {string} workspacePath - Path to workspace
 * @returns {Promise<object>} Verification result
 */
async function verifyWorkspaceStructure(workspacePath) {
  const results = {
    workspaceConfigExists: false,
    cursorDirExists: false,
    commandsDirExists: false,
    rulesDirExists: false,
    mcpJsonExists: false,
    cacheDirExists: false,
    cursorignoreExists: false,
    errors: []
  };

  try {
    // Check workspace.config.json
    const configPath = path.join(workspacePath, 'workspace.config.json');
    try {
      await fs.access(configPath);
      results.workspaceConfigExists = true;
    } catch (e) {
      results.errors.push('workspace.config.json not found');
    }

    // Check .cursor directory
    const cursorDir = path.join(workspacePath, '.cursor');
    try {
      const stat = await fs.stat(cursorDir);
      if (stat.isDirectory()) {
        results.cursorDirExists = true;
      }
    } catch (e) {
      results.errors.push('.cursor directory not found');
    }

    // Check .cursor/commands
    const commandsDir = path.join(cursorDir, 'commands');
    try {
      await fs.access(commandsDir);
      results.commandsDirExists = true;
    } catch (e) {
      results.errors.push('.cursor/commands directory not found');
    }

    // Check .cursor/rules
    const rulesDir = path.join(cursorDir, 'rules');
    try {
      await fs.access(rulesDir);
      results.rulesDirExists = true;
    } catch (e) {
      results.errors.push('.cursor/rules directory not found');
    }

    // Check .cursor/mcp.json
    const mcpJsonPath = path.join(cursorDir, 'mcp.json');
    try {
      await fs.access(mcpJsonPath);
      results.mcpJsonExists = true;
    } catch (e) {
      results.errors.push('.cursor/mcp.json not found');
    }

    // Check .cache/devduck
    const cacheDir = path.join(workspacePath, '.cache', 'devduck');
    try {
      await fs.access(cacheDir);
      results.cacheDirExists = true;
    } catch (e) {
      results.errors.push('.cache/devduck directory not found');
    }

    // Check .cursorignore
    const cursorignorePath = path.join(workspacePath, '.cursorignore');
    try {
      await fs.access(cursorignorePath);
      results.cursorignoreExists = true;
    } catch (e) {
      results.errors.push('.cursorignore not found');
    }
  } catch (error) {
    results.errors.push(`Error during verification: ${error.message}`);
  }

  return results;
}

/**
 * Verify workspace.config.json content
 * @param {string} workspacePath - Path to workspace
 * @param {object} expectedConfig - Expected configuration (partial match)
 * @returns {Promise<object>} Verification result
 */
async function verifyWorkspaceConfig(workspacePath, expectedConfig = {}) {
  const results = {
    valid: false,
    config: null,
    errors: []
  };

  try {
    const configPath = path.join(workspacePath, 'workspace.config.json');
    const content = await fs.readFile(configPath, 'utf8');
    results.config = JSON.parse(content);

    // Verify required fields
    if (!results.config.workspaceVersion) {
      results.errors.push('workspaceVersion missing');
    }
    if (!results.config.modules || !Array.isArray(results.config.modules)) {
      results.errors.push('modules missing or invalid');
    }

    // Verify expected values
    if (expectedConfig.modules) {
      const actualModules = results.config.modules || [];
      const expectedModules = expectedConfig.modules;
      const missing = expectedModules.filter(m => !actualModules.includes(m));
      if (missing.length > 0) {
        results.errors.push(`Missing modules: ${missing.join(', ')}`);
      }
    }

    if (expectedConfig.devduckPath && results.config.devduckPath !== expectedConfig.devduckPath) {
      results.errors.push(`devduckPath mismatch: expected ${expectedConfig.devduckPath}, got ${results.config.devduckPath}`);
    }

    results.valid = results.errors.length === 0;
  } catch (error) {
    results.errors.push(`Error reading config: ${error.message}`);
  }

  return results;
}

/**
 * Verify module installation
 * @param {string} workspacePath - Path to workspace
 * @param {Array<string>} expectedModules - Expected module names
 * @returns {Promise<object>} Verification result
 */
async function verifyModuleInstallation(workspacePath, expectedModules = []) {
  const results = {
    modulesFound: [],
    modulesMissing: [],
    commandsFound: 0,
    rulesFound: false,
    errors: []
  };

  try {
    // Check commands directory
    const commandsDir = path.join(workspacePath, '.cursor', 'commands');
    try {
      const files = await fs.readdir(commandsDir);
      results.commandsFound = files.length;
    } catch (e) {
      results.errors.push('Cannot read commands directory');
    }

    // Check rules file
    const rulesPath = path.join(workspacePath, '.cursor', 'rules', 'devduck-rules.md');
    try {
      await fs.access(rulesPath);
      results.rulesFound = true;
    } catch (e) {
      results.errors.push('devduck-rules.md not found');
    }

    // Check MCP config
    const mcpPath = path.join(workspacePath, '.cursor', 'mcp.json');
    try {
      const mcpContent = await fs.readFile(mcpPath, 'utf8');
      const mcpConfig = JSON.parse(mcpContent);
      if (mcpConfig.mcpServers) {
        results.modulesFound = Object.keys(mcpConfig.mcpServers);
      }
    } catch (e) {
      results.errors.push('Cannot read mcp.json');
    }

    // Check which expected modules are missing
    if (expectedModules.length > 0) {
      results.modulesMissing = expectedModules.filter(m => !results.modulesFound.includes(m));
    }
  } catch (error) {
    results.errors.push(`Error during module verification: ${error.message}`);
  }

  return results;
}

/**
 * Wait for installation to complete
 * @param {string} workspacePath - Path to workspace
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} checkInterval - Interval between checks in milliseconds
 * @returns {Promise<boolean>} True if installation completed
 */
async function waitForInstallation(workspacePath, timeout = 30000, checkInterval = 100) {
  const startTime = Date.now();
  const configPath = path.join(workspacePath, 'workspace.config.json');
  const cacheDir = path.join(workspacePath, '.cache', 'devduck');

  while (Date.now() - startTime < timeout) {
    try {
      await fs.access(configPath);
      await fs.access(cacheDir);
      return true;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  return false;
}

/**
 * Create a mock workspace.config.json for existing workspace tests
 * @param {string} workspacePath - Path to workspace
 * @param {object} config - Configuration object
 */
async function createMockWorkspace(workspacePath, config = {}) {
  const defaultConfig = {
    workspaceVersion: '0.1.0',
    devduckPath: './devduck',
    modules: ['core', 'cursor'],
    moduleSettings: {}
  };

  const finalConfig = { ...defaultConfig, ...config };
  const configPath = path.join(workspacePath, 'workspace.config.json');
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(finalConfig, null, 2), 'utf8');
}

/**
 * Check if installer result indicates failure and throw early
 * @param {object} result - Result from runInstaller
 * @throws {Error} If installer failed
 */
function checkInstallerResult(result) {
  if (result.exitCode !== 0) {
    const errorMsg = result.stderr || result.stdout || 'Unknown error';
    throw new Error(`Installer failed with exit code ${result.exitCode}. Error: ${errorMsg}`);
  }
}

module.exports = {
  createTempWorkspace,
  cleanupTempWorkspace,
  runInstaller,
  verifyWorkspaceStructure,
  verifyWorkspaceConfig,
  verifyModuleInstallation,
  waitForInstallation,
  createMockWorkspace,
  checkInstallerResult
};

