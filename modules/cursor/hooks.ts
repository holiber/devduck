/**
 * Cursor module hooks
 * 
 * Defines installation hooks for Cursor IDE integration.
 */

import fs from 'fs';
import path from 'path';
import type { HookContext, HookResult } from '../../scripts/install/module-hooks.js';
import { replaceVariablesInObject } from '../../scripts/lib/config.js';
import { readEnvFile } from '../../scripts/lib/env.js';

export default {
  /**
   * Post-install hook: Copy commands, merge rules, generate mcp.json
   * Executes after all modules are installed, so it has access to allModules
   */
  async 'post-install'(context: HookContext): Promise<HookResult> {
    const createdFiles: string[] = [];
    
    // Ensure directories exist
    fs.mkdirSync(context.commandsDir, { recursive: true });
    fs.mkdirSync(context.rulesDir, { recursive: true });
    
    // 1. Copy commands from all modules
    // Note: context.allModules contains module objects with path and name
    // We need to collect commands from module directories
    // Safety: Don't overwrite existing command files
    let commandsCount = 0;
    let skippedCommands = 0;
    for (const module of context.allModules) {
      const moduleCommandsDir = path.join(module.path, 'commands');
      if (fs.existsSync(moduleCommandsDir)) {
        const commandFiles = fs.readdirSync(moduleCommandsDir, { withFileTypes: true });
        for (const entry of commandFiles) {
          if (entry.isFile()) {
            const srcPath = path.join(moduleCommandsDir, entry.name);
            const destPath = path.join(context.commandsDir, entry.name);
            
            // Safety check: Don't overwrite existing files
            if (fs.existsSync(destPath)) {
              skippedCommands++;
              continue;
            }
            
            fs.copyFileSync(srcPath, destPath);
            commandsCount++;
            createdFiles.push(`.cursor/commands/${entry.name}`);
          }
        }
      }
    }
    
    // 2. Merge rules from all modules
    const rulesContent: string[] = [];
    let rulesCount = 0;
    for (const module of context.allModules) {
      const moduleRulesDir = path.join(module.path, 'rules');
      if (fs.existsSync(moduleRulesDir)) {
        const ruleFiles = fs.readdirSync(moduleRulesDir, { withFileTypes: true });
        for (const entry of ruleFiles) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const rulePath = path.join(moduleRulesDir, entry.name);
            const content = fs.readFileSync(rulePath, 'utf8');
            rulesContent.push(`# From module: ${module.name}\n\n${content}\n\n---\n\n`);
            rulesCount++;
          }
        }
      }
    }
    
    if (rulesContent.length > 0) {
      const rulesPath = path.join(context.rulesDir, 'devduck-rules.md');
      fs.writeFileSync(rulesPath, rulesContent.join('\n'), 'utf8');
      createdFiles.push('.cursor/rules/devduck-rules.md');
    }
    
    // 3. Generate mcp.json from all modules
    // Load environment variables for variable substitution
    // Re-read .env file right before generating mcp.json to pick up any variables
    // set by other post-install hooks (e.g., MCP_STORE_PROXY_PATH from ya-core)
    const envFilePath = path.join(context.workspaceRoot, '.env');
    let env = readEnvFile(envFilePath);
    
    // Also merge in process.env to catch variables set by hooks
    env = { ...env, ...process.env };
    
    const mcpServers: Record<string, unknown> = {};
    for (const module of context.allModules) {
      // First, try to load mcpSettings from module frontmatter (MODULE.md)
      // This is the preferred way for modules to provide MCP configuration
      const { loadModuleFromPath } = await import('../../scripts/install/module-resolver.js');
      const moduleWithMcp = loadModuleFromPath(module.path, module.name);
      if (moduleWithMcp?.mcpSettings) {
        // mcpSettings from frontmatter is a map of server names to server configs
        // Replace variables in mcpSettings before adding to mcpServers
        const replacedMcpSettings = replaceVariablesInObject(moduleWithMcp.mcpSettings, env);
        Object.assign(mcpServers, replacedMcpSettings);
      } else {
        // Fallback: try to load from mcp.json file (legacy support)
        const mcpPath = path.join(module.path, 'mcp.json');
        if (fs.existsSync(mcpPath)) {
          try {
            const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as Record<string, unknown>;
            // Handle mcp.json structure: { mcpServers: { ... } }
            if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
              const replacedConfig = replaceVariablesInObject(mcpConfig.mcpServers, env);
              Object.assign(mcpServers, replacedConfig);
            } else if (typeof mcpConfig === 'object') {
              // Direct object assignment
              const replacedConfig = replaceVariablesInObject(mcpConfig, env);
              Object.assign(mcpServers, replacedConfig);
            } else {
              mcpServers[module.name] = mcpConfig;
            }
          } catch (error) {
            const err = error as Error;
            console.warn(`Warning: Failed to parse mcp.json for module ${module.name}: ${err.message}`);
          }
        }
      }
    }
    
    // Always create mcp.json, even if empty
    const mcpFilePath = path.join(context.cursorDir, 'mcp.json');
    const mcpConfig = { mcpServers };
    fs.writeFileSync(mcpFilePath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
    createdFiles.push('.cursor/mcp.json');
    
    // 3.5. Test MCP servers functionality
    if (Object.keys(mcpServers).length > 0) {
      const { testMcpServer } = await import('../../scripts/install/mcp-test.js');
      const testResults: Array<{ name: string; success: boolean; error?: string }> = [];
      
      for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
        const config = serverConfig as Record<string, unknown>;
        
        // Only test command-based servers (not URL-based)
        if (config.command && typeof config.command === 'string') {
          try {
            const result = await testMcpServer(serverName, {
              command: config.command as string,
              args: Array.isArray(config.args) ? config.args as string[] : []
            }, {
              timeout: 10000,
              log: (msg) => {
                // Silent logging during installation
              }
            });
            
            testResults.push({
              name: serverName,
              success: result.success,
              error: result.error
            });
            
            if (result.success && result.methods && result.methods.length > 0) {
              // Server is working and has methods
              console.log(`✓ MCP server ${serverName} tested successfully (${result.methods.length} method(s))`);
            } else if (!result.success) {
              // Log warning but don't fail installation
              console.warn(`Warning: MCP server ${serverName} test failed: ${result.error || 'Unknown error'}`);
            } else if (result.success) {
              console.log(`✓ MCP server ${serverName} tested successfully (no methods listed)`);
            }
          } catch (error) {
            const err = error as Error;
            console.warn(`Warning: Failed to test MCP server ${serverName}: ${err.message}`);
            testResults.push({
              name: serverName,
              success: false,
              error: err.message
            });
          }
        }
      }
      
      // Log summary
      const successfulTests = testResults.filter(r => r.success).length;
      const totalTests = testResults.length;
      if (totalTests > 0) {
        console.log(`\nMCP servers tested: ${successfulTests}/${totalTests} successful`);
      }
    }
    
    // 4. Create .cursorignore file
    const cursorignorePath = path.join(context.workspaceRoot, '.cursorignore');
    const cursorignoreContent = [
      '# Environment variables',
      '.env',
      '.env.local',
      '.env.*.local',
      '',
      '# Cache directory',
      '.cache/',
      '',
      '# IDE and editor files',
      '.vscode/',
      '.idea/',
      '*.swp',
      '*.swo',
      '*~',
      '',
      '# OS files',
      '.DS_Store',
      'Thumbs.db',
      '',
      '# node modules',
      'node_modules/',
      'package-lock.json',
      'yarn.lock',
      '',
      '# Build outputs',
      'dist/',
      'build/',
      '*.log',
      '',
      '# Temporary files',
      '*.tmp',
      '*.temp'
    ].join('\n');
    
    fs.writeFileSync(cursorignorePath, cursorignoreContent + '\n', 'utf8');
    createdFiles.push('.cursorignore');
    
    let message = `Installed ${commandsCount} commands, ${rulesCount} rules, ${Object.keys(mcpServers).length} MCP servers, created .cursorignore`;
    if (skippedCommands > 0) {
      message += ` (skipped ${skippedCommands} existing command files)`;
    }
    
    return {
      success: true,
      createdFiles,
      message
    };
  }
};

