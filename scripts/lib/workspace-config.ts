import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { readJSON, writeJSON } from './config.js';

export const WORKSPACE_CONFIG_BASENAMES = [
  'workspace.config.yml',
  'workspace.config.yaml',
  'workspace.config.json'
] as const;

export type WorkspaceConfigFormat = 'yaml' | 'json';

export function findWorkspaceConfigFile(workspaceRoot: string): string | null {
  for (const name of WORKSPACE_CONFIG_BASENAMES) {
    const p = path.join(workspaceRoot, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function getWorkspaceConfigFilePath(workspaceRoot: string): string {
  return findWorkspaceConfigFile(workspaceRoot) || path.join(workspaceRoot, 'workspace.config.json');
}

function detectFormat(filePath: string): WorkspaceConfigFormat {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.json' ? 'json' : 'yaml';
}

/**
 * Normalize YAML "nadformat" keys into the legacy JSON shape used across the codebase.
 *
 * Supported mappings:
 * - devduck_path -> devduckPath
 * - version -> (ignored for now; treated as schema version, not workspaceVersion)
 *
 * If workspaceVersion is missing, default to "0.1.0" to preserve existing assumptions.
 */
export function normalizeWorkspaceConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const obj = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...obj };

  if (typeof normalized.devduckPath !== 'string' && typeof normalized.devduck_path === 'string') {
    normalized.devduckPath = normalized.devduck_path;
  }

  // Keep existing JSON field if already present; otherwise keep installer expectations stable.
  if (typeof normalized.workspaceVersion !== 'string') {
    normalized.workspaceVersion = '0.1.0';
  }

  return normalized;
}

export function readWorkspaceConfigFile<T = Record<string, unknown>>(filePath: string): T | null {
  try {
    const format = detectFormat(filePath);
    if (format === 'json') return (readJSON<T>(filePath) as T | null) ?? null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = YAML.parse(raw) as unknown;
    const normalized = normalizeWorkspaceConfig(parsed);
    return (normalized as unknown as T) ?? null;
  } catch {
    return null;
  }
}

export function readWorkspaceConfigFromRoot<T = Record<string, unknown>>(
  workspaceRoot: string
): { config: T | null; configFile: string } {
  const configFile = getWorkspaceConfigFilePath(workspaceRoot);
  return { config: readWorkspaceConfigFile<T>(configFile), configFile };
}

export function writeWorkspaceConfigFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const format = detectFormat(filePath);
  if (format === 'json') {
    writeJSON(filePath, data);
    return;
  }
  const normalized = normalizeWorkspaceConfig(data) ?? (data as Record<string, unknown>);
  const out = YAML.stringify(normalized);
  fs.writeFileSync(filePath, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

