/**
 * Playwright module hooks
 * 
 * Defines installation hooks for Playwright testing module.
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  /**
   * Install hook: Add VHS scripts to workspace package.json
   */
  async 'install'(context) {
    const packageJsonPath = path.join(context.workspaceRoot, 'package.json');
    const createdFiles = [];
    
    // Check if package.json exists
    if (!fs.existsSync(packageJsonPath)) {
      // Create a minimal package.json if it doesn't exist
      const minimalPackageJson = {
        name: path.basename(context.workspaceRoot),
        version: '0.1.0',
        private: true,
        scripts: {}
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2) + '\n', 'utf8');
      createdFiles.push('package.json');
    }
    
    // Read existing package.json
    let packageJson;
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf8');
      packageJson = JSON.parse(content);
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to read/parse package.json: ${error.message}`]
      };
    }
    
    // Ensure scripts section exists
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    
    // Define VHS scripts to add
    const vhsScripts = {
      'vhs': 'vhs tests/installer/tapes/fresh-workspace-gui.tape',
      'vhs:fresh': 'vhs tests/installer/tapes/fresh-workspace-gui.tape',
      'vhs:existing': 'vhs tests/installer/tapes/existing-workspace-gui.tape'
    };
    
    // Add scripts if they don't exist or update them
    let scriptsAdded = 0;
    for (const [scriptName, scriptCommand] of Object.entries(vhsScripts)) {
      if (!packageJson.scripts[scriptName] || packageJson.scripts[scriptName] !== scriptCommand) {
        packageJson.scripts[scriptName] = scriptCommand;
        scriptsAdded++;
      }
    }
    
    // Write updated package.json
    try {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
      return {
        success: true,
        createdFiles: createdFiles.length > 0 ? createdFiles : [],
        message: scriptsAdded > 0 
          ? `Added ${scriptsAdded} VHS script(s) to package.json`
          : 'VHS scripts already present in package.json'
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to write package.json: ${error.message}`]
      };
    }
  },

  /**
   * Test hook: Test VHS availability
   */
  async 'test'(context) {
    const { execSync } = require('child_process');
    
    try {
      // Check if vhs command is available
      execSync('vhs --version', { stdio: 'ignore' });
      return {
        success: true,
        message: 'VHS is installed and available'
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          'VHS is not installed or not available in PATH',
          'Install with: brew install vhs (macOS)',
          'Or download from: https://github.com/charmbracelet/vhs/releases'
        ]
      };
    }
  }
};

