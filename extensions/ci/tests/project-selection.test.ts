import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';

import ci from '../api.js';
import { workspace } from '@barducks/sdk';

function getProc<TInput, TOutput>(shape: any, name: string) {
  const p = shape.api?.[name];
  if (!p) throw new Error(`Missing api procedure: ${name}`);
  return p as { handler: (args: { input: TInput; ctx: any }) => Promise<TOutput> };
}

type Captured = { lastProjectId?: string };

function makeProviderCapture(captured: Captured) {
  return {
    name: 'test-provider',
    version: '0.0.0',
    manifest: { type: 'ci', name: 'test-provider', version: '0.0.0', protocolVersion: 'x', tools: [] as string[] },
    pr: {
      list: async () => [],
      get: async () => ({ id: 'x', title: '', commentCount: 0, reviewers: [] }),
      post: async (input: any) => {
        captured.lastProjectId = input.projectId;
        return { id: 'pr-x', title: input.title || '', commentCount: 0, reviewers: [] };
      },
      delete: async () => ({ ok: true }),
      checks: { list: async () => [], get: async () => ({ id: 'c', name: 'c', status: 'completed', annotations: [] }) }
    },
    comment: {
      list: async () => [],
      get: async () => ({ id: 'c', body: '', author: { login: 'x' }, createdAt: new Date().toISOString(), reactions: [] }),
      post: async () => ({ id: 'c', body: '', author: { login: 'x' }, createdAt: new Date().toISOString(), reactions: [] }),
      put: async () => ({ id: 'c', body: '', author: { login: 'x' }, createdAt: new Date().toISOString(), reactions: [] }),
      delete: async () => ({ ok: true })
    }
  };
}

describe('ci: pr.post project selection', () => {
  beforeEach(() => {
    workspace.projects.clear();
  });

  test('single project mode: pr.post without projectId uses the only project', async () => {
    workspace.projects.post({ id: 'p1', src: 'git@github.com:org/repo.git' });
    const captured: Captured = {};
    const provider = makeProviderCapture(captured);

    const shape = ci({ ci: provider } as any, {} as any);
    const prPost = getProc<any, any>(shape, 'pr.post');
    await prPost.handler({ input: { title: 't', from: 'a', to: 'b' }, ctx: { provider: null } });
    assert.equal(captured.lastProjectId, 'p1');
  });

  test('multi project mode: pr.post without projectId and without active project throws', async () => {
    workspace.projects.post({ id: 'p1', src: 'git@github.com:org/repo1.git' });
    workspace.projects.post({ id: 'p2', src: 'git@github.com:org/repo2.git' });
    const provider = makeProviderCapture({});

    const shape = ci({ ci: provider } as any, {} as any);
    const prPost = getProc<any, any>(shape, 'pr.post');

    await assert.rejects(async () => {
      await prPost.handler({ input: { title: 't', from: 'a', to: 'b' }, ctx: { provider: null } });
    });
  });

  test('multi project mode: pr.post with explicit projectId works', async () => {
    workspace.projects.post({ id: 'p1', src: 'git@github.com:org/repo1.git' });
    workspace.projects.post({ id: 'p2', src: 'git@github.com:org/repo2.git' });
    const captured: Captured = {};
    const provider = makeProviderCapture(captured);

    const shape = ci({ ci: provider } as any, {} as any);
    const prPost = getProc<any, any>(shape, 'pr.post');
    await prPost.handler({ input: { title: 't', from: 'a', to: 'b', projectId: 'p2' }, ctx: { provider: null } });
    assert.equal(captured.lastProjectId, 'p2');
  });

  test('multi project mode: pr.post works after setActive project', async () => {
    workspace.projects.post({ id: 'p1', src: 'git@github.com:org/repo1.git' });
    workspace.projects.post({ id: 'p2', src: 'git@github.com:org/repo2.git' });
    workspace.projects.setActive('p1');

    const captured: Captured = {};
    const provider = makeProviderCapture(captured);

    const shape = ci({ ci: provider } as any, {} as any);
    const prPost = getProc<any, any>(shape, 'pr.post');
    await prPost.handler({ input: { title: 't', from: 'a', to: 'b' }, ctx: { provider: null } });
    assert.equal(captured.lastProjectId, 'p1');
  });
});

