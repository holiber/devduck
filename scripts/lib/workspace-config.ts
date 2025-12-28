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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function concatDedupeArray(key: string, arr: unknown[]): unknown[] {
  const output: unknown[] = [];
  const keyOf = (item: unknown): string => {
    if (key === 'projects' && isPlainObject(item) && typeof item.src === 'string') return `src:${item.src}`;
    if ((key === 'checks' || key === 'env') && isPlainObject(item) && typeof item.name === 'string') return `name:${item.name}`;
    try {
      return `json:${JSON.stringify(item)}`;
    } catch {
      // Fallback for cyclic/unstringifiable objects.
      return `str:${String(item)}`;
    }
  };

  for (const item of arr) {
    const k = keyOf(item);
    const existing = output.findIndex((x) => keyOf(x) === k);
    if (existing >= 0) output.splice(existing, 1);
    output.push(item);
  }
  return output;
}

function deepMergeWorkspaceConfig(base: unknown, next: unknown, keyHint?: string): unknown {
  if (Array.isArray(base) && Array.isArray(next)) {
    return concatDedupeArray(keyHint ?? '', [...base, ...next]);
  }

  if (isPlainObject(base) && isPlainObject(next)) {
    const out: WorkspaceConfigObject = { ...base };
    for (const [k, v] of Object.entries(next)) {
      if (k in out) out[k] = deepMergeWorkspaceConfig(out[k], v, k);
      else out[k] = v;
    }
    return out;
  }

  // Primitive / null / mismatched types: last one wins.
  return next;
}

function parseExtendsField(layer: WorkspaceConfigObject): string[] {
  const ext = layer.extends;
  if (!Array.isArray(ext)) return [];
  return ext.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

function getDevduckPathFromEntryLayer(entryLayer: WorkspaceConfigObject): string {
  const p = entryLayer.devduck_path;
  if (typeof p === 'string' && p.trim().length > 0) return p.trim();
  // Backward-compatible default for installer-driven workspaces.
  return './projects/devduck';
}

function resolveExtendsPath(params: {
  extendsRef: string;
  fromFilePath: string;
  workspaceRoot: string;
  devduckPathRel: string;
}): string {
  const { extendsRef, fromFilePath, workspaceRoot, devduckPathRel } = params;

  if (extendsRef.startsWith('devduck:')) {
    const rel = extendsRef.slice('devduck:'.length).replace(/^\/+/, '');
    const devduckRootAbs = path.resolve(workspaceRoot, devduckPathRel);
    return path.resolve(devduckRootAbs, rel);
  }

  if (path.isAbsolute(extendsRef)) return extendsRef;
  return path.resolve(path.dirname(fromFilePath), extendsRef);
}

export function readWorkspaceConfigFileResolved<T = Record<string, unknown>>(params: {
  workspaceRoot: string;
  entryFilePath: string;
}): { config: T | null; configFile: string } {
  const { workspaceRoot, entryFilePath } = params;
  const absEntry = path.resolve(entryFilePath);
  const entryLayer = readWorkspaceConfigFile<WorkspaceConfigObject>(absEntry);
  if (!entryLayer) return { config: null, configFile: absEntry };

  const devduckPathRel = getDevduckPathFromEntryLayer(entryLayer);
  const visiting: string[] = [];
  const visited = new Set<string>();

  function readLayerRecursive(filePath: string): WorkspaceConfigObject {
    const abs = path.resolve(filePath);

    const cycleStart = visiting.indexOf(abs);
    if (cycleStart >= 0) {
      const chain = [...visiting.slice(cycleStart), abs].map((p) => path.relative(workspaceRoot, p) || p).join(' -> ');
      throw new Error(`Workspace config extends cycle detected: ${chain}`);
    }

    if (visited.has(abs)) {
      // Already merged elsewhere; treat as empty here to avoid double-application.
      return {};
    }

    const layer = readWorkspaceConfigFile<WorkspaceConfigObject>(abs);
    if (!layer) {
      throw new Error(`Workspace config extends file not found or unreadable: ${abs}`);
    }

    visiting.push(abs);
    const refs = parseExtendsField(layer);

    let merged: WorkspaceConfigObject = {};
    for (const ref of refs) {
      const resolved = resolveExtendsPath({
        extendsRef: ref,
        fromFilePath: abs,
        workspaceRoot,
        devduckPathRel
      });
      const child = readLayerRecursive(resolved);
      merged = deepMergeWorkspaceConfig(merged, child) as WorkspaceConfigObject;
    }

    // Apply this layer last.
    merged = deepMergeWorkspaceConfig(merged, layer) as WorkspaceConfigObject;
    visiting.pop();
    visited.add(abs);

    return merged;
  }

  const merged = readLayerRecursive(absEntry);
  return { config: merged as unknown as T, configFile: absEntry };
}

export function readWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);
  return readWorkspaceConfigFileResolved<T>({ workspaceRoot, entryFilePath: configFile });
}

export function writeWorkspaceConfigFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return;
  const normalized = normalizeWorkspaceConfig(data) ?? (data as Record<string, unknown>);
  const out = YAML.stringify(normalized);
  fs.writeFileSync(filePath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

