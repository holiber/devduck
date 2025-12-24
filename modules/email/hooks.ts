/**
 * Email module hooks
 *
 * Minimal install hook: ensures cache directory exists.
 */

import fs from 'fs';
import path from 'path';
import type { HookContext, HookResult } from '../../scripts/install/module-hooks.js';

export default {
  async install(context: HookContext): Promise<HookResult> {
    try {
      const emailCacheDir = path.join(context.cacheDir, 'email');
      fs.mkdirSync(emailCacheDir, { recursive: true });
      return {
        success: true,
        createdFiles: ['.cache/devduck/email/'],
        message: 'Created email cache directory'
      };
    } catch (e) {
      const err = e as Error;
      return {
        success: false,
        errors: [`Failed to create email cache directory: ${err.message}`]
      };
    }
  }
};

