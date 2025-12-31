import { test, expect } from '@playwright/test';
import path from 'node:path';

import { resolveWorkspaceRoot, _internal } from '../src/lib/workspace-path.ts';

test.describe('workspace-path resolver', () => {
  test('parses ark:/ links as ark links', () => {
    const url = _internal.tryParseUrl('ark:/some/path/file.txt');
    expect(url, 'should parse as URL').toBeTruthy();
    expect(url?.protocol).toBe('ark:');
    expect(_internal.isLikelyArkUrl(url!)).toBe(true);
    expect(_internal.parseArkSubpath(url!)).toBe('some/path/file.txt');
  });

  test('resolves ark:/ links using arc root (fallback to arc root)', () => {
    const res = resolveWorkspaceRoot('ark:/some/path/file.txt', {
      projectRoot: '/project',
      getArcRoot: () => '/repo-root',
      getGitRoot: () => null,
      fsExistsSync: () => false,
      findWorkspaceRoot: () => null
    });

    expect(res).toBe(path.resolve('/repo-root'));
  });

  test('resolves ark:/ links using arc root and strips repo/ prefix', () => {
    const res = resolveWorkspaceRoot('ark:/repo/some/path/file.txt', {
      projectRoot: '/project',
      getArcRoot: () => '/repo-root',
      getGitRoot: () => null,
      fsExistsSync: () => true,
      findWorkspaceRoot: () => null
    });

    expect(res).toBe(path.resolve('/repo-root'));
  });

  test('if arc root is unavailable, ark:/ falls back to projectRoot', () => {
    const res = resolveWorkspaceRoot('ark:/some/path/file.txt', {
      projectRoot: '/project',
      getArcRoot: () => null,
      getGitRoot: () => null,
      fsExistsSync: () => false,
      findWorkspaceRoot: () => null
    });

    expect(res).toBe(path.resolve('/project'));
  });
});

