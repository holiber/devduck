#!/usr/bin/env node

const { test, describe } = require('node:test');
const assert = require('node:assert');

const path = require('node:path');
const { resolveWorkspaceRoot, _internal } = require('../scripts/lib/workspace-path');

describe('workspace-path resolver', () => {
  test('parses ark:/ links as Arcadia links', () => {
    const url = _internal.tryParseUrl('ark:/some/path/file.txt');
    assert.ok(url, 'should parse as URL');
    assert.strictEqual(url.protocol, 'ark:');
    assert.strictEqual(_internal.isLikelyArcadiaUrl(url), true);
    assert.strictEqual(_internal.parseArkSubpath(url), 'some/path/file.txt');
  });

  test('resolves ark:/ links using arc root (fallback to arc root)', () => {
    const res = resolveWorkspaceRoot('ark:/some/path/file.txt', {
      projectRoot: '/project',
      getArcadiaRoot: () => '/arcadia-root',
      getGitRoot: () => null,
      fsExistsSync: () => false,
      findWorkspaceRoot: () => null
    });

    assert.strictEqual(res, path.resolve('/arcadia-root'));
  });

  test('resolves ark:/ links using arc root and strips arcadia/ prefix', () => {
    const res = resolveWorkspaceRoot('ark:/arcadia/some/path/file.txt', {
      projectRoot: '/project',
      getArcadiaRoot: () => '/arcadia-root',
      getGitRoot: () => null,
      fsExistsSync: () => true,
      findWorkspaceRoot: () => null
    });

    assert.strictEqual(res, path.resolve('/arcadia-root'));
  });

  test('if arc root is unavailable, ark:/ falls back to projectRoot', () => {
    const res = resolveWorkspaceRoot('ark:/some/path/file.txt', {
      projectRoot: '/project',
      getArcadiaRoot: () => null,
      getGitRoot: () => null,
      fsExistsSync: () => false,
      findWorkspaceRoot: () => null
    });

    assert.strictEqual(res, path.resolve('/project'));
  });
});

