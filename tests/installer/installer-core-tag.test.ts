import test from 'node:test';
import assert from 'node:assert/strict';

import { getAllModules, resolveModules } from '../../src/install/module-resolver.js';

test('modules tagged core are auto-included even if not listed in workspace config', () => {
  const all = getAllModules();
  const names = all.map((m) => m.name);
  assert.ok(names.includes('installer'), 'installer module should exist in built-in extensions');

  const cfg = { extensions: ['core', 'cursor'] };
  const resolved = resolveModules(cfg as any, all).map((m) => m.name);

  assert.ok(resolved.includes('installer'), 'installer (tagged core) should be auto-included');
});

