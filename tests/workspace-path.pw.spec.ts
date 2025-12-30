import { test, expect } from '@playwright/test';
import path from 'node:path';

import { resolveWorkspaceRoot, _internal } from '../src/lib/workspace-path.ts';

test.describe('workspace-path resolver', () => {
  test('parses ark:/ links as Arcadia links', () => {
    const url = _internal.tryParseUrl('ark:/some/path/file.txt');
    expect(url, 'should parse as URL').toBeTruthy();
    expect(url?.protocol).toBe('ark:');
    expect(_internal.isLikelyArcadiaUrl(url!)).toBe(true);
    expect(_internal.parseArkSubpath(url!)).toBe('some/path/file.txt');
  });

  test('resolves ark:/ links using arc root (fallback to arc root)', () => {
    const res = resolveWorkspaceRoot('ark:/some/path/file.txt', {
      projectRoot: '/project',
      getArcadiaRoot: () => '/arcadia-root',
      getGitRoot: () => null,
      fsExistsSync: () => false,
      findWorkspaceRoot: () => null
    });

    expect(res).toBe(path.resolve('/arcadia-root'));
  });

  test('resolves ark:/ links using arc root and strips arcadia/ prefix', () => {
    const res = resolveWorkspaceRoot('ark:/arcadia/some/path/file.txt', {
      projectRoot: '/project',
      getArcadiaRoot: () => '/arcadia-root',
      getGitRoot: () => null,
      fsExistsSync: () => true,
      findWorkspaceRoot: () => null
    });

    expect(res).toBe(path.resolve('/arcadia-root'));
  });

  test('if arc root is unavailable, ark:/ falls back to projectRoot', () => {
    const res = resolveWorkspaceRoot('ark:/some/path/file.txt', {
      projectRoot: '/project',
      getArcadiaRoot: () => null,
      getGitRoot: () => null,
      fsExistsSync: () => false,
      findWorkspaceRoot: () => null
    });

    expect(res).toBe(path.resolve('/project'));
  });
});

