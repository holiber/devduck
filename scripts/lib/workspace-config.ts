import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export const WORKSPACE_CONFIG_BASENAMES = [
  'workspace.config.yml',
  'workspace.config.yaml'
] as const;

const LEGACY_JSON_BASENAME = ['workspace.config.', 'json'].join('');

export function findWorkspaceConfigFile(workspaceRoot: string): string | null {
  const legacy = path.join(workspaceRoot, LEGACY_JSON_BASENAME);
  if (fs.existsSync(legacy)) {
    throw new Error(
      `Legacy workspace config format is not supported. Convert/rename your workspace config to "workspace.config.yml".`
    );
  }

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
 * Normalize YAML keys into the shape used across the codebase.
 *
 * Supported mappings:
 * - devduck_path -> devduckPath
 * - version -> workspaceVersion (string)
 */
export function normalizeWorkspaceConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...obj };

  if (typeof normalized.devduckPath !== 'string' && typeof normalized.devduck_path === 'string') {
    normalized.devduckPath = normalized.devduck_path;
    // Avoid writing/propagating duplicates.
    delete normalized.devduck_path;
  }

  // version -> workspaceVersion (preserve meaning; do not silently overwrite valid input)
  if (normalized.workspaceVersion === undefined && normalized.version !== undefined) {
    normalized.workspaceVersion = String(normalized.version);
  }
  if (typeof normalized.workspaceVersion === 'number') {
    normalized.workspaceVersion = String(normalized.workspaceVersion);
  }

  // Keep installer expectations stable only if no version was provided at all.
  if (normalized.workspaceVersion === undefined) {
    normalized.workspaceVersion = '0.1.0';
  }

  return normalized;
}

export function readWorkspaceConfigFile<T = Record<string, unknown>>(filePath: string): T | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    throw new Error(
      `Legacy workspace config format is not supported. Convert/rename your workspace config to "workspace.config.yml".`
    );
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw) as unknown;
  const normalized = normalizeWorkspaceConfig(parsed);
  return (normalized as unknown as T) ?? null;
}

export function readWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);
  return { config: readWorkspaceConfigFile<T>(configFile), configFile };
}

export function writeWorkspaceConfigFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    throw new Error(
      `Legacy workspace config format is not supported. Write to "workspace.config.yml" instead.`
    );
  }
  const normalized = normalizeWorkspaceConfig(data) ?? (data as Record<string, unknown>);
  const out = YAML.stringify(normalized);
  fs.writeFileSync(filePath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

