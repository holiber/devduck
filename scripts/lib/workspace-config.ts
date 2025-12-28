import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export const WORKSPACE_CONFIG_BASENAMES = [
  'workspace.config.yml',
  'workspace.config.yaml'
] as const;

type WorkspaceConfigObject = Record<string, unknown>;

export function findWorkspaceConfigFile(workspaceRoot: string): string | null {
  const matches: string[] = [];
  for (const name of WORKSPACE_CONFIG_BASENAMES) {
    const p = path.join(workspaceRoot, name);
    if (fs.existsSync(p)) matches.push(p);
  }

  if (matches.length > 1) {
    const list = matches.map((p) => path.basename(p)).sort().join(', ');
    throw new Error(
      `Multiple workspace config files found (${list}). Keep only one: "workspace.config.yml" or "workspace.config.yaml".`
    );
  }

  return matches[0] || null;
}

export function getWorkspaceConfigFilePath(workspaceRoot: string): string {
  // Default is YAML-only.
  return findWorkspaceConfigFile(workspaceRoot) || path.join(workspaceRoot, 'workspace.config.yml');
}

/**
 * Ensure minimal defaults for workspace config.
 */
export function normalizeWorkspaceConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...obj };

  if (normalized.version === undefined) {
    normalized.version = '0.1.0';
  }

  return normalized;
}

export function readWorkspaceConfigFile<T = Record<string, unknown>>(filePath: string): T | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return null;

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw) as unknown;
  const normalized = normalizeWorkspaceConfig(parsed);
  return (normalized as unknown as T) ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeArraysWithRules(key: string, base: unknown[], override: unknown[]): unknown[] {
  const combined = [...base, ...override];

  // Keyed-dedupe (last wins) for well-known arrays.
  const keyProp =
    key === 'projects' ? 'src' : key === 'checks' || key === 'env' ? 'name' : null;

  if (keyProp) {
    const out = new Map<string, unknown>();
    for (const item of combined) {
      if (!isPlainObject(item)) continue;
      const k = item[keyProp];
      if (typeof k !== 'string' || !k.trim()) continue;
      // last one wins but preserve last occurrence order
      if (out.has(k)) out.delete(k);
      out.set(k, item);
    }
    // Keep non-keyed items too (append after, in original order).
    const nonKeyed = combined.filter((it) => !isPlainObject(it) || typeof it[keyProp] !== 'string');
    return [...out.values(), ...nonKeyed];
  }

  // String arrays: concat + dedupe (last wins).
  if (combined.every((v) => typeof v === 'string')) {
    const out = new Map<string, string>();
    for (const v of combined as string[]) {
      if (out.has(v)) out.delete(v);
      out.set(v, v);
    }
    return [...out.values()];
  }

  // Fallback: attempt to dedupe by a stable-ish JSON key (last wins).
  const out = new Map<string, unknown>();
  for (const item of combined) {
    let k: string;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      k = String(item);
    } else {
      try {
        k = JSON.stringify(item);
      } catch {
        k = String(item);
      }
    }
    if (out.has(k)) out.delete(k);
    out.set(k, item);
  }
  return [...out.values()];
}

function deepMergeWithRules(base: unknown, override: unknown, keyPath: string[] = []): unknown {
  if (Array.isArray(base) && Array.isArray(override)) {
    const key = keyPath[keyPath.length - 1] || '';
    return mergeArraysWithRules(key, base, override);
  }

  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(override)) {
      if (k === 'extends') continue; // do not propagate extends into resolved output
      if (k in out) {
        out[k] = deepMergeWithRules(out[k], v, [...keyPath, k]);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  // Primitive / mismatched types: override wins.
  return override;
}

function resolveExtendsEntry(entry: string, opts: { fromFile: string; devduckRoot: string }): string {
  const trimmed = entry.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('devduck:')) {
    const rel = trimmed.slice('devduck:'.length).replace(/^\/+/, '');
    return path.resolve(opts.devduckRoot, rel);
  }
  if (path.isAbsolute(trimmed)) return trimmed;
  // Relative to the file that declares the extends (supports nested baselines).
  return path.resolve(path.dirname(opts.fromFile), trimmed);
}

function readYamlConfigObject(filePath: string): WorkspaceConfigObject {
  const cfg = readWorkspaceConfigFile<WorkspaceConfigObject>(filePath);
  if (!cfg) {
    throw new Error(`Cannot read workspace config: ${filePath}`);
  }
  return cfg;
}

function resolveConfigWithExtends(params: {
  entryFile: string;
  devduckRoot: string;
  maxDepth?: number;
}): WorkspaceConfigObject {
  const maxDepth = Number.isFinite(params.maxDepth) ? Number(params.maxDepth) : 20;

  const cache = new Map<string, WorkspaceConfigObject>();
  const stack: string[] = [];

  function load(filePath: string, depth: number): WorkspaceConfigObject {
    const abs = path.resolve(filePath);
    if (depth > maxDepth) {
      throw new Error(`workspace config extends is too deep (>${maxDepth}):\n${stack.join('\n')}`);
    }
    if (stack.includes(abs)) {
      const cycle = [...stack, abs].map((p) => `- ${p}`).join('\n');
      throw new Error(`workspace config extends cycle detected:\n${cycle}`);
    }
    if (cache.has(abs)) return cache.get(abs)!;

    stack.push(abs);
    const raw = readYamlConfigObject(abs);
    const extendsList = Array.isArray(raw.extends) ? (raw.extends as unknown[]).filter((e) => typeof e === 'string') as string[] : [];

    let merged: WorkspaceConfigObject = { ...raw };
    delete (merged as { extends?: unknown }).extends;

    if (extendsList.length > 0) {
      // Start from the first base, apply next bases, then finally apply this file.
      let baseAcc: WorkspaceConfigObject | null = null;
      for (const ent of extendsList) {
        const resolved = resolveExtendsEntry(ent, { fromFile: abs, devduckRoot: params.devduckRoot });
        if (!resolved) continue;
        const baseCfg = load(resolved, depth + 1);
        baseAcc = (baseAcc ? (deepMergeWithRules(baseAcc, baseCfg) as WorkspaceConfigObject) : baseCfg);
      }
      if (baseAcc) {
        merged = deepMergeWithRules(baseAcc, merged) as WorkspaceConfigObject;
      }
    }

    stack.pop();
    cache.set(abs, merged);
    return merged;
  }

  return load(params.entryFile, 0);
}

export function readResolvedWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);
  const raw = readWorkspaceConfigFile<WorkspaceConfigObject>(configFile);
  if (!raw) return { config: null, configFile };

  const devduckPathRel =
    typeof raw.devduck_path === 'string' && raw.devduck_path.trim().length > 0
      ? raw.devduck_path.trim()
      : './projects/devduck';
  const devduckRoot = path.resolve(workspaceRoot, devduckPathRel);

  const resolved = resolveConfigWithExtends({ entryFile: configFile, devduckRoot });
  return { config: resolved as unknown as T, configFile };
}

export function readWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  // Default to resolved config (supports `extends`) to keep workspace config the single source of truth.
  return readResolvedWorkspaceConfigFromRoot<T>(workspaceRoot);
}

export function writeWorkspaceConfigFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return;
  const normalized = normalizeWorkspaceConfig(data) ?? (data as Record<string, unknown>);
  const out = YAML.stringify(normalized);
  fs.writeFileSync(filePath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

