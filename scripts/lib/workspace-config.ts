import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export const WORKSPACE_CONFIG_BASENAMES = [
  'workspace.config.yml',
  'workspace.config.yaml'
] as const;

type WorkspaceConfigRaw = Record<string, unknown> & {
  extends?: string[];
  devduck_path?: string;
  taskfile?: {
    vars?: Record<string, string>;
    tasks?: Record<string, unknown>;
  };
  projects?: Array<{ src?: string } & Record<string, unknown>>;
  checks?: Array<{ name?: string } & Record<string, unknown>>;
  env?: Array<{ name?: string } & Record<string, unknown>>;
};

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

export function readWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string,
  options?: { withExtends?: boolean }
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);
  const withExtends = options?.withExtends ?? true;
  
  const config = withExtends
    ? readWorkspaceConfigFileWithExtends<T>(configFile, workspaceRoot)
    : readWorkspaceConfigFile<T>(configFile);
  
  return { config, configFile };
}

export function writeWorkspaceConfigFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return;
  const normalized = normalizeWorkspaceConfig(data) ?? (data as Record<string, unknown>);
  const out = YAML.stringify(normalized);
  fs.writeFileSync(filePath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

/**
 * Resolve a config path that might use `devduck:` prefix.
 * @param configPath - Path to resolve (e.g., "devduck:defaults/workspace.install.yml")
 * @param workspaceRoot - Workspace root directory
 * @param devduckPath - DevDuck installation path (from config.devduck_path)
 * @param baseDir - Base directory for relative paths (defaults to workspaceRoot)
 * @returns Absolute path to the config file
 */
function resolveConfigPath(
  configPath: string,
  workspaceRoot: string,
  devduckPath: string | undefined,
  baseDir?: string
): string {
  const trimmed = configPath.trim();
  
  if (trimmed.startsWith('devduck:')) {
    const relativePath = trimmed.slice('devduck:'.length);
    const devduckRoot = devduckPath 
      ? path.resolve(workspaceRoot, devduckPath)
      : path.resolve(workspaceRoot, './devduck/src');
    return path.resolve(devduckRoot, relativePath);
  }
  
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  
  const base = baseDir || workspaceRoot;
  return path.resolve(base, trimmed);
}

/**
 * Deep merge two objects with concat+dedupe semantics for arrays.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];
    
    // Arrays: concat + dedupe
    if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
      result[key] = dedupeArray([...targetValue, ...sourceValue], key);
    }
    // Objects: deep merge
    else if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    }
    // Primitives and other types: source overwrites target
    else {
      result[key] = sourceValue;
    }
  }
  
  return result;
}

/**
 * Deduplicate array based on array type.
 * - projects: dedupe by `src`
 * - checks/env: dedupe by `name`
 * - other arrays: dedupe by JSON stringification
 */
function dedupeArray(arr: unknown[], arrayKey: string): unknown[] {
  if (arrayKey === 'projects') {
    const seen = new Set<string>();
    return arr.filter((item) => {
      if (!item || typeof item !== 'object') return true;
      const src = (item as { src?: string }).src;
      if (!src) return true;
      if (seen.has(src)) return false;
      seen.add(src);
      return true;
    });
  }
  
  if (arrayKey === 'checks' || arrayKey === 'env') {
    const seen = new Set<string>();
    return arr.filter((item) => {
      if (!item || typeof item !== 'object') return true;
      const name = (item as { name?: string }).name;
      if (!name) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }
  
  // Generic dedupe by JSON stringification
  const seen = new Set<string>();
  return arr.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Load and merge workspace config with extends support.
 * @param filePath - Path to the workspace config file
 * @param workspaceRoot - Workspace root directory (for resolving paths)
 * @param visited - Set of visited config paths (for cycle detection)
 * @returns Merged workspace config
 */
function loadWorkspaceConfigWithExtends<T = Record<string, unknown>>(
  filePath: string,
  workspaceRoot: string,
  visited: Set<string> = new Set()
): T | null {
  const normalizedPath = path.resolve(filePath);
  
  // Cycle detection
  if (visited.has(normalizedPath)) {
    const chain = Array.from(visited).join(' → ');
    throw new Error(
      `Circular extends dependency detected: ${chain} → ${normalizedPath}\n` +
      `Remove the circular reference from your workspace config extends chain.`
    );
  }
  
  visited.add(normalizedPath);
  
  // Load current config
  const raw = readWorkspaceConfigFile<WorkspaceConfigRaw>(normalizedPath);
  if (!raw) {
    throw new Error(
      `Cannot load workspace config: ${normalizedPath}\n` +
      `Ensure the file exists and contains valid YAML.`
    );
  }
  
  // If no extends, return normalized config
  if (!raw.extends || !Array.isArray(raw.extends) || raw.extends.length === 0) {
    return raw as unknown as T;
  }
  
  // Load and merge extended configs
  let merged: Record<string, unknown> = {};
  const baseDir = path.dirname(normalizedPath);
  
  for (const extendPath of raw.extends) {
    if (typeof extendPath !== 'string') {
      throw new Error(
        `Invalid extends entry in ${normalizedPath}: expected string, got ${typeof extendPath}\n` +
        `Each extends entry must be a string path.`
      );
    }
    
    const resolvedPath = resolveConfigPath(
      extendPath,
      workspaceRoot,
      raw.devduck_path,
      baseDir
    );
    
    const extendedConfig = loadWorkspaceConfigWithExtends<Record<string, unknown>>(
      resolvedPath,
      workspaceRoot,
      new Set(visited)
    );
    
    if (extendedConfig) {
      merged = deepMerge(merged, extendedConfig);
    }
  }
  
  // Merge current config on top of extended configs
  // Remove extends from final config to avoid re-processing
  const { extends: _extends, ...configWithoutExtends } = raw;
  merged = deepMerge(merged, configWithoutExtends);
  
  return merged as unknown as T;
}

/**
 * Read workspace config with extends resolution.
 * @param filePath - Path to the workspace config file
 * @param workspaceRoot - Workspace root directory (defaults to parent of config file)
 * @returns Merged workspace config
 */
export function readWorkspaceConfigFileWithExtends<T = Record<string, unknown>>(
  filePath: string,
  workspaceRoot?: string
): T | null {
  try {
    const wsRoot = workspaceRoot || path.dirname(filePath);
    return loadWorkspaceConfigWithExtends<T>(filePath, wsRoot);
  } catch (error) {
    // Re-throw with better error message
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to load workspace config: ${String(error)}`);
  }
}

