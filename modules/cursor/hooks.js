/**
 * Cursor module hooks
 * 
 * Defines installation hooks for Cursor IDE integration.
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  /**
   * Post-install hook: Copy commands, merge rules, generate mcp.json
   * Executes after all modules are installed, so it has access to allModules
   */
  async 'post-install'(context) {
    const createdFiles = [];
    
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
    const rulesContent = [];
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
    const mcpServers = {};
    for (const module of context.allModules) {
      const mcpPath = path.join(module.path, 'mcp.json');
      if (fs.existsSync(mcpPath)) {
        try {
          const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
          // Handle mcp.json structure: { mcpServers: { ... } }
          if (mcpConfig.mcpServers) {
            Object.assign(mcpServers, mcpConfig.mcpServers);
          } else if (typeof mcpConfig === 'object') {
            // Direct object assignment
            Object.assign(mcpServers, mcpConfig);
          } else {
            mcpServers[module.name] = mcpConfig;
          }
        } catch (error) {
          console.warn(`Warning: Failed to parse mcp.json for module ${module.name}: ${error.message}`);
        }
      }
    }
    
    // Always create mcp.json, even if empty
    const mcpFilePath = path.join(context.cursorDir, 'mcp.json');
    const mcpConfig = { mcpServers };
    fs.writeFileSync(mcpFilePath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
    createdFiles.push('.cursor/mcp.json');
    
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

