import fs from 'node:fs';
import path from 'node:path';
import { afterEach } from 'node:test';

import { workspace } from './lib/workspace';

function safePathSegment(s: string): string {
  return String(s || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200) || 'unnamed_test';
}

function fullTestName(t: any): string {
  const parts: string[] = [];
  let cur = t;
  // Node test objects typically have `name` and `parent`.
  while (cur && typeof cur === 'object') {
    const n = typeof cur.name === 'string' ? cur.name : '';
    if (n) parts.unshift(n);
    cur = cur.parent;
  }
  const joined = parts.join(' > ');
  return joined || (typeof t?.name === 'string' ? t.name : 'test');
}

function serializeWorkspaceResources() {
  const typesObj = Object.fromEntries(workspace.resources.types.entries());
  const instancesObj = Object.fromEntries(workspace.resources.instances.entries());
  return {
    types: typesObj,
    instances: instancesObj
  };
}

function detectRecursiveDependency(resources: { instances: Record<string, any> }): string[] {
  const instances = resources.instances || {};
  const keys = new Set(Object.keys(instances));

  // Build edges based on `root` references that point to another known resourceId.
  const edges = new Map<string, string[]>();
  for (const [rid, inst] of Object.entries(instances)) {
    const root = inst && typeof inst.root === 'string' ? inst.root.trim() : '';
    if (root && keys.has(root)) {
      edges.set(rid, [root]);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      const cycle = idx >= 0 ? stack.slice(idx).concat(node) : [node, node];
      return cycle;
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of edges.get(node) || []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of edges.keys()) {
    const cycle = dfs(node);
    if (cycle) {
      return [`recursive dependency: ${cycle.join(' -> ')}`];
    }
  }
  return [];
}

afterEach(async (t) => {
  // Always dump if workspace singleton exists (it does after import).
  const name = fullTestName(t);
  const dir = path.join(process.cwd(), '.cache', 'artifacts', 'unit', safePathSegment(name));
  fs.mkdirSync(dir, { recursive: true });

  const resources = serializeWorkspaceResources();
  const warnings = detectRecursiveDependency(resources as any);

  if (warnings.length > 0) {
    // Big WARNING in output
    for (const w of warnings) {
      // eslint-disable-next-line no-console
      console.error(`\nWARNING: ${w}\n`);
    }
  }

  const outPath = path.join(dir, 'workspace.resources.json');
  const payload = {
    testName: name,
    warnings,
    resources
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
});

