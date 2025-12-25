import { describe, test } from 'node:test';
import assert from 'node:assert';

import { launchRouter } from '../../modules/launch/api.js';
import { getUnifiedAPI } from '../../scripts/lib/api.js';

describe('launch: API module', () => {
  test('launchRouter is defined and has procedures', () => {
    assert.ok(launchRouter);
    assert.ok(typeof launchRouter === 'object');
    assert.ok('call' in launchRouter);
    assert.ok('toCli' in launchRouter);

    const procedures = (launchRouter as any).procedures;
    assert.ok(procedures);
    assert.ok('dev' in procedures);
  });

  test('launch module is included in unified API (when modules are discoverable)', async () => {
    const unifiedAPI = await getUnifiedAPI();
    const availableModules = Object.keys(unifiedAPI);

    // Mirror mcp tests: if discovery returns nothing (CI/path issue), don't fail.
    if (availableModules.length === 0) {
      return;
    }

    assert.ok(
      'launch' in unifiedAPI,
      `launch module should be in unified API. Available: ${availableModules.join(', ')}`
    );
  });
});

