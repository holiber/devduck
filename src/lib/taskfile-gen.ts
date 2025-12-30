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

function normalizeDevduckRootVarValue(devduckPathRel: string): string {
  // We want absolute-ish paths inside the generated taskfile because it's executed from `.cache/`.
  // This keeps it correct regardless of the current working directory.
  if (path.isAbsolute(devduckPathRel)) return devduckPathRel;
  const cleaned = devduckPathRel.replace(/\\/g, '/').trim().replace(/^\.\/+/, '');
  return cleaned ? `{{.WORKSPACE_ROOT}}/${cleaned}` : '{{.WORKSPACE_ROOT}}/projects/devduck';
}

function injectedVars(devduckPathRel: string): Record<string, string> {
  return {
    // Taskfile is written to `.cache/` by default, so workspace root is its parent directory.
    WORKSPACE_ROOT: '{{ default (printf "%s/.." .TASKFILE_DIR) .WORKSPACE_ROOT }}',
    DEVDUCK_ROOT: normalizeDevduckRootVarValue(devduckPathRel),
  };
}

function buildFromTaskfileSection(taskfile: WorkspaceConfigLike['taskfile'], devduckPathRel: string): GeneratedTaskfile | null {
  if (!taskfile || !isPlainObject(taskfile) || !isPlainObject(taskfile.tasks)) return null;
  const output =
    typeof taskfile.output === 'string' && taskfile.output.trim().length > 0 ? taskfile.output.trim() : 'interleaved';
  const varsFromConfig = extractStringMap(taskfile.vars);

  return {
    version: '3',
    output,
    vars: {
      ...varsFromConfig,
      ...injectedVars(devduckPathRel),
    },
    tasks: taskfile.tasks,
  };
}

function tryReadBaselineTaskfileSection(params: { workspaceRoot: string; devduckPathRel: string }): WorkspaceConfigLike['taskfile'] | null {
  const { workspaceRoot, devduckPathRel } = params;
  const devduckRootAbs = path.resolve(workspaceRoot, devduckPathRel);
  const baselinePath = path.join(devduckRootAbs, 'defaults', 'workspace.install.yml');
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
 * 2) Else, use DevDuck baseline defaults from `<devduckRoot>/defaults/workspace.install.yml`.
 *
 * This keeps installation step definitions in ONE place (the baseline file).
 */
export function buildGeneratedTaskfile(params: {
  workspaceRoot: string;
  config: WorkspaceConfigLike;
  devduckPathRel: string;
}): GeneratedTaskfile {
  const { workspaceRoot, config, devduckPathRel } = params;

  const fromConfig = buildFromTaskfileSection(config.taskfile, devduckPathRel);
  if (fromConfig) return fromConfig;

  const baselineTaskfile = tryReadBaselineTaskfileSection({ workspaceRoot, devduckPathRel });
  const fromBaseline = buildFromTaskfileSection(baselineTaskfile ?? undefined, devduckPathRel);
  if (fromBaseline) return fromBaseline;

  // Last resort: minimal, to avoid crashing older installs. Prefer adding baseline file instead.
  return {
    version: '3',
    output: 'interleaved',
    vars: injectedVars(devduckPathRel),
    tasks: {
      install: {
        desc: 'Install baseline missing: no tasks defined',
        cmds: [
          'echo "ERROR: No taskfile config found. Please add extends: devduck:defaults/workspace.install.yml" && exit 1'
        ],
      },
    },
  };
}

