/**
 * Git module hooks
 * 
 * Defines installation hooks for the git module.
 */

import fs from 'fs';
import path from 'path';
import type { HookContext, HookResult } from '../../scripts/install/module-hooks.js';

export default {
  /**
   * Install hook: Create .gitignore file
   */
  async 'install'(context: HookContext): Promise<HookResult> {
    // Create .gitignore from settings
    const gitignorePath = path.join(context.workspaceRoot, '.gitignore');
    const content = (context.settings.gitignore as string) || '';
    
    if (content) {
      try {
        fs.writeFileSync(gitignorePath, content, 'utf8');
        return {
          success: true,
          createdFiles: ['.gitignore'],
          message: 'Created .gitignore file'
        };
      } catch (error) {
        const err = error as Error;
        return {
          success: false,
          errors: [`Failed to create .gitignore: ${err.message}`]
        };
      }
    }
    
    return {
      success: true,
      message: 'No gitignore content to write'
    };
  }
};

