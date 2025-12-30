import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { installerRouter } from '../../extensions/installer/api.js';

test('installer.pickProviderForSrc picks installer-fs-provider for existing local directory', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'barducks-installer-src-'));
  try {
    const res = await installerRouter.call('pickProviderForSrc', { src: tmp }, { provider: null as any });
    assert.equal(res.provider, 'installer-fs-provider');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('installer.pickProviderForSrc picks installer-git-provider for GitHub URL', async () => {
  const res = await installerRouter.call(
    'pickProviderForSrc',
    { src: 'https://github.com/holiber/barducks.git' },
    { provider: null as any }
  );
  assert.equal(res.provider, 'installer-git-provider');
});

