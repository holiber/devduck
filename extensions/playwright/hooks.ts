/**
 * Playwright module hooks
 * 
 * Defines installation hooks for Playwright testing module.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { HookContext, HookResult } from '../../src/install/module-hooks.js';

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export default {
  /**
   * Install hook: Add VHS scripts to workspace package.json
   */
  async 'install'(context: HookContext): Promise<HookResult> {
    const packageJsonPath = path.join(context.workspaceRoot, 'package.json');
    const createdFiles: string[] = [];
    
    // Check if package.json exists
    if (!fs.existsSync(packageJsonPath)) {
      // Create a minimal package.json if it doesn't exist
      const minimalPackageJson: PackageJson = {
        name: path.basename(context.workspaceRoot),
        version: '0.1.0',
        private: true,
        scripts: {}
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2) + '\n', 'utf8');
      createdFiles.push('package.json');
    }
    
    // Read existing package.json
    let packageJson: PackageJson;
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf8');
      packageJson = JSON.parse(content) as PackageJson;
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        errors: [`Failed to read/parse package.json: ${err.message}`]
      };
    }
    
    // Ensure scripts section exists
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }
    
    // Define VHS scripts to add
    const vhsScripts: Record<string, string> = {
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
      const err = error as Error;
      return {
        success: false,
        errors: [`Failed to write package.json: ${err.message}`]
      };
    }
  },

  /**
   * Test hook: Test VHS availability
   */
  async 'test'(context: HookContext): Promise<HookResult> {
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

