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

