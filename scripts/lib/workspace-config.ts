import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export const WORKSPACE_CONFIG_BASENAMES = [
  'workspace.config.yml',
  'workspace.config.yaml'
] as const;

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

/**
 * Read a single YAML config file without extends resolution.
 */
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

// ---------------------------------------------------------------------------
// Extends resolution and deep merge
// ---------------------------------------------------------------------------

/**
 * Resolve an extends path to an absolute file path.
 *
 * Supports:
 * - "devduck:<relative-path>" - resolved via devduck_path
 * - Absolute paths
 * - Relative paths (resolved from baseDir, typically the directory of the config file)
 */
export function resolveExtendsPath(
  extendsPath: string,
  baseDir: string,
  devduckPath: string | null
): string {
  if (extendsPath.startsWith('devduck:')) {
    const relativePath = extendsPath.slice('devduck:'.length);
    if (!devduckPath) {
      throw new Error(
        `Cannot resolve "${extendsPath}": devduck_path is not set. ` +
          `Set devduck_path in your workspace config or use an absolute/relative path.`
      );
    }
    // devduckPath may be relative to workspace root, so resolve from baseDir
    const resolvedDevduck = path.isAbsolute(devduckPath)
      ? devduckPath
      : path.resolve(baseDir, devduckPath);
    return path.resolve(resolvedDevduck, relativePath);
  }

  if (path.isAbsolute(extendsPath)) {
    return extendsPath;
  }

  return path.resolve(baseDir, extendsPath);
}

/**
 * Check if a value is a plain object (not array, null, etc.).
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Dedupe an array by a key function, keeping the last occurrence.
 */
function dedupeArrayByKey<T>(arr: T[], keyFn: (item: T) => string | undefined): T[] {
  const seen = new Map<string, number>();
  const result: T[] = [];

  for (const item of arr) {
    const key = keyFn(item);
    if (key !== undefined) {
      const existingIdx = seen.get(key);
      if (existingIdx !== undefined) {
        // Replace existing with newer
        result[existingIdx] = item;
      } else {
        seen.set(key, result.length);
        result.push(item);
      }
    } else {
      // No key, just add
      result.push(item);
    }
  }

  return result;
}

/**
 * Get the dedupe key for array items based on the field name.
 */
function getArrayItemKey(fieldName: string, item: unknown): string | undefined {
  if (!isPlainObject(item)) return undefined;

  // projects: dedupe by "src"
  if (fieldName === 'projects') {
    const src = item.src;
    return typeof src === 'string' ? src : undefined;
  }

  // checks, env: dedupe by "name"
  if (fieldName === 'checks' || fieldName === 'env') {
    const name = item.name;
    return typeof name === 'string' ? name : undefined;
  }

  // taskfile.tasks: handled separately (it's an object, not array)
  return undefined;
}

/**
 * Deep merge two configs with concat+dedupe semantics for arrays.
 *
 * Merge rules:
 * - Objects: deep-merge recursively
 * - Arrays: concat + dedupe (projects by src, checks/env by name)
 * - Primitives: override (later wins)
 */
export function deepMergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];

    if (overrideVal === undefined) {
      continue;
    }

    if (Array.isArray(overrideVal)) {
      if (Array.isArray(baseVal)) {
        // Concat + dedupe
        const combined = [...baseVal, ...overrideVal];
        result[key] = dedupeArrayByKey(combined, (item) => getArrayItemKey(key, item));
      } else {
        result[key] = overrideVal;
      }
    } else if (isPlainObject(overrideVal)) {
      if (isPlainObject(baseVal)) {
        // Deep merge objects
        result[key] = deepMergeConfigs(baseVal, overrideVal);
      } else {
        result[key] = overrideVal;
      }
    } else {
      // Primitive: override
      result[key] = overrideVal;
    }
  }

  return result;
}

/**
 * Load a config file and recursively resolve its extends chain.
 *
 * @param filePath - Absolute path to the config file
 * @param workspaceRoot - Workspace root for resolving relative devduck_path
 * @param visited - Set of already-visited file paths (for cycle detection)
 * @param inheritedDevduckPath - devduck_path inherited from parent configs
 */
export function loadConfigWithExtends(
  filePath: string,
  workspaceRoot: string,
  visited: Set<string> = new Set(),
  inheritedDevduckPath: string | null = null
): Record<string, unknown> | null {
  const normalizedPath = path.resolve(filePath);

  // Cycle detection
  if (visited.has(normalizedPath)) {
    const chain = Array.from(visited).join(' -> ');
    throw new Error(
      `Circular extends detected: ${chain} -> ${normalizedPath}`
    );
  }

  visited.add(normalizedPath);

  const config = readWorkspaceConfigFile<Record<string, unknown>>(filePath);
  if (!config) {
    return null;
  }

  const baseDir = path.dirname(normalizedPath);

  // Determine devduck_path: use config's value, fallback to inherited
  const configDevduckPath = config.devduck_path as string | undefined;
  const effectiveDevduckPath = configDevduckPath ?? inheritedDevduckPath;

  // Get extends array
  const extendsArr = config.extends as string[] | undefined;
  if (!extendsArr || !Array.isArray(extendsArr) || extendsArr.length === 0) {
    return config;
  }

  // Load all base configs in order and merge
  let mergedBase: Record<string, unknown> = {};

  for (const extPath of extendsArr) {
    const resolvedPath = resolveExtendsPath(extPath, baseDir, effectiveDevduckPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Extended config not found: "${extPath}" (resolved to "${resolvedPath}")`
      );
    }

    const baseConfig = loadConfigWithExtends(
      resolvedPath,
      workspaceRoot,
      new Set(visited), // Clone to allow diamond dependencies
      effectiveDevduckPath
    );

    if (baseConfig) {
      mergedBase = deepMergeConfigs(mergedBase, baseConfig);
    }
  }

  // Merge: base -> current config (current config wins)
  // Remove 'extends' from result to avoid confusion
  const { extends: _extends, ...configWithoutExtends } = config;
  return deepMergeConfigs(mergedBase, configWithoutExtends);
}

/**
 * Read workspace config with extends resolution.
 *
 * This is the main entry point for reading a fully-merged config.
 */
export function readMergedWorkspaceConfig<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);

  if (!fs.existsSync(configFile)) {
    return { config: null, configFile };
  }

  const merged = loadConfigWithExtends(configFile, workspaceRoot);
  return { config: merged as T | null, configFile };
}

/**
 * Read workspace config from root (original, without extends resolution).
 * This is kept for backwards compatibility.
 */
export function readWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);
  return { config: readWorkspaceConfigFile<T>(configFile), configFile };
}

export function writeWorkspaceConfigFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return;
  const normalized = normalizeWorkspaceConfig(data) ?? (data as Record<string, unknown>);
  const out = YAML.stringify(normalized);
  fs.writeFileSync(filePath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

