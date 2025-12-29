/**
 * Messenger module hooks
 *
 * Minimal install hook: ensures cache directory exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { HookContext, HookResult } from '../../src/install/module-hooks.js';

export default {
  async install(context: HookContext): Promise<HookResult> {
    try {
      const messengerCacheDir = path.join(context.cacheDir, 'messenger');
      fs.mkdirSync(messengerCacheDir, { recursive: true });
      return {
        success: true,
        createdFiles: ['.cache/devduck/messenger/'],
        message: 'Created messenger cache directory'
      };
    } catch (e) {
      const err = e as Error;
      return {
        success: false,
        errors: [`Failed to create messenger cache directory: ${err.message}`]
      };
    }
  }
};

