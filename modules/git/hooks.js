/**
 * Git module hooks
 * 
 * Defines installation hooks for the git module.
 */

const fs = require('fs');
const path = require('path');

module.exports = {
  /**
   * Install hook: Create .gitignore file
   */
  async 'install'(context) {
    // Create .gitignore from settings
    const gitignorePath = path.join(context.workspaceRoot, '.gitignore');
    const content = context.settings.gitignore || '';
    
    if (content) {
      try {
        fs.writeFileSync(gitignorePath, content, 'utf8');
        return {
          success: true,
          createdFiles: ['.gitignore'],
          message: 'Created .gitignore file'
        };
      } catch (error) {
        return {
          success: false,
          errors: [`Failed to create .gitignore: ${error.message}`]
        };
      }
    }
    
    return {
      success: true,
      message: 'No gitignore content to write'
    };
  }
};

