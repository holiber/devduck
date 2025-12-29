#!/usr/bin/env node

/**
 * github-ci module hooks
 * 
 * Defines installation hooks for the github-ci module.
 */

import fs from 'fs';
import path from 'path';
import type { HookContext, HookResult } from '../../../scripts/install/module-hooks.js';

export default {
  /**
   * Install hook: Create .gitignore file
   */
  async 'install'(context: HookContext): Promise<HookResult> {
    // Create .gitignore from settings or default file
    const gitignorePath = path.join(context.workspaceRoot, '.gitignore');
    
    // First try to get content from settings
    let content = (context.settings.gitignore as string | undefined) || '';
    
    // If no content from settings, try to read from gitignore.default file
    if (!content) {
      const defaultFilePath = path.join(context.modulePath, 'gitignore.default');
      if (fs.existsSync(defaultFilePath)) {
        try {
          content = fs.readFileSync(defaultFilePath, 'utf8');
        } catch (error) {
          const err = error as Error;
          return {
            success: false,
            errors: [`Failed to read gitignore.default: ${err.message}`]
          };
        }
      }
    }
    
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

