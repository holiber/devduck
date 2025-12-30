import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type GeneratedTaskfile = {
  version: string;
  output?: string;
  vars?: Record<string, string>;
  tasks: Record<string, unknown>;
};

type WorkspaceConfigLike = Record<string, unknown> & {
  taskfile?: {
    output?: string;
    vars?: Record<string, unknown>;
    tasks?: Record<string, unknown>;
  };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function normalizeBarducksRootVarValue(barducksPathRel: string): string {
  // We want absolute-ish paths inside the generated taskfile because it's executed from `.cache/`.
  // This keeps it correct regardless of the current working directory.
  if (path.isAbsolute(barducksPathRel)) return barducksPathRel;
  const cleaned = barducksPathRel.replace(/\\/g, '/').trim().replace(/^\.\/+/, '');
  return cleaned ? `{{.WORKSPACE_ROOT}}/${cleaned}` : '{{.WORKSPACE_ROOT}}/projects/barducks';
}

function injectedVars(barducksPathRel: string): Record<string, string> {
  return {
    // Taskfile is written to `.cache/` by default, so workspace root is its parent directory.
    WORKSPACE_ROOT: '{{ default (printf "%s/.." .TASKFILE_DIR) .WORKSPACE_ROOT }}',
    BARDUCKS_ROOT: normalizeBarducksRootVarValue(barducksPathRel),
  };
}

function buildFromTaskfileSection(taskfile: WorkspaceConfigLike['taskfile'], barducksPathRel: string): GeneratedTaskfile | null {
  if (!taskfile || !isPlainObject(taskfile) || !isPlainObject(taskfile.tasks)) return null;
  const output =
    typeof taskfile.output === 'string' && taskfile.output.trim().length > 0 ? taskfile.output.trim() : 'interleaved';
  const varsFromConfig = extractStringMap(taskfile.vars);

  return {
    version: '3',
    output,
    vars: {
      ...varsFromConfig,
      ...injectedVars(barducksPathRel),
    },
    tasks: taskfile.tasks,
  };
}

function tryReadBaselineTaskfileSection(params: { workspaceRoot: string; barducksPathRel: string }): WorkspaceConfigLike['taskfile'] | null {
  const { workspaceRoot, barducksPathRel } = params;
  const barducksRootAbs = path.resolve(workspaceRoot, barducksPathRel);
  const baselinePath = path.join(barducksRootAbs, 'defaults', 'workspace.install.yml');
  try {
    if (!fs.existsSync(baselinePath)) return null;
    const raw = fs.readFileSync(baselinePath, 'utf8');
    const parsed = YAML.parse(raw) as { taskfile?: unknown } | null;
    const taskfile = parsed && typeof parsed === 'object' ? (parsed as { taskfile?: unknown }).taskfile : null;
    return isPlainObject(taskfile) ? (taskfile as WorkspaceConfigLike['taskfile']) : null;
  } catch {
    return null;
  }
}

/**
 * Build `.cache/taskfile.generated.yml` from the merged workspace config.
 *
 * Fallback strategy:
 * 1) Use `config.taskfile` if present.
 * 2) Else, use Barducks baseline defaults from `<barducksRoot>/defaults/workspace.install.yml`.
 *
 * This keeps installation step definitions in ONE place (the baseline file).
 */
export function buildGeneratedTaskfile(params: {
  workspaceRoot: string;
  config: WorkspaceConfigLike;
  barducksPathRel: string;
}): GeneratedTaskfile {
  const { workspaceRoot, config, barducksPathRel } = params;

  const fromConfig = buildFromTaskfileSection(config.taskfile, barducksPathRel);
  if (fromConfig) return fromConfig;

  const baselineTaskfile = tryReadBaselineTaskfileSection({ workspaceRoot, barducksPathRel });
  const fromBaseline = buildFromTaskfileSection(baselineTaskfile ?? undefined, barducksPathRel);
  if (fromBaseline) return fromBaseline;

  // Last resort: minimal, to avoid crashing older installs. Prefer adding baseline file instead.
  return {
    version: '3',
    output: 'interleaved',
    vars: injectedVars(barducksPathRel),
    tasks: {
      install: {
        desc: 'Install baseline missing: no tasks defined',
        cmds: [
          'echo "ERROR: No taskfile config found. Please add extends: barducks:defaults/workspace.install.yml" && exit 1'
        ],
      },
    },
  };
}

