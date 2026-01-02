import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';

import core from '../api.js';
import { workspace } from '@barducks/sdk';

function getProc<TInput, TOutput>(shape: any, name: string) {
  const p = shape.api?.[name];
  if (!p) throw new Error(`Missing api procedure: ${name}`);
  return p as { handler: (args: { input: TInput; ctx: any }) => Promise<TOutput> };
}

describe('core: project API', () => {
  beforeEach(() => {
    workspace.projects.clear();
  });

  test('single project: getActive returns the only project (without setActive)', async () => {
    const shape = core({} as any, {} as any);
    const post = getProc<{ projectId: string; src: string }, any>(shape, 'project.post');
    const getActive = getProc<{}, any>(shape, 'project.getActive');

    await post.handler({ input: { projectId: 'p1', src: 'git@github.com:org/repo.git' }, ctx: { provider: null } });
    const active = await getActive.handler({ input: {}, ctx: { provider: null } });
    assert.ok(active);
    assert.equal(active.id, 'p1');
    assert.equal(active.resourceId, 'project:p1');
  });

  test('multi project: getActive returns null until setActive is called', async () => {
    const shape = core({} as any, {} as any);
    const post = getProc<{ projectId: string; src: string }, any>(shape, 'project.post');
    const getActive = getProc<{}, any>(shape, 'project.getActive');
    const setActive = getProc<{ projectId: string }, any>(shape, 'project.setActive');

    await post.handler({ input: { projectId: 'p1', src: 'git@github.com:org/repo1.git' }, ctx: { provider: null } });
    await post.handler({ input: { projectId: 'p2', src: 'git@github.com:org/repo2.git' }, ctx: { provider: null } });

    const before = await getActive.handler({ input: {}, ctx: { provider: null } });
    assert.equal(before, null);

    await setActive.handler({ input: { projectId: 'p2' }, ctx: { provider: null } });
    const after = await getActive.handler({ input: {}, ctx: { provider: null } });
    assert.ok(after);
    assert.equal(after.id, 'p2');
  });
});

