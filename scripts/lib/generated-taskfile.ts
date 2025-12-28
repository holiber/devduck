export type GeneratedTaskfile = {
  version: string;
  output?: string;
  vars?: Record<string, string>;
  tasks: Record<string, unknown>;
};

type WorkspaceConfigLike = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function coerceStringMap(v: unknown): Record<string, string> {
  if (!isPlainObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

export function buildDefaultGeneratedTaskfile(devduckPathRel: string): GeneratedTaskfile {
  const stepCmd = (stepId: string) =>
    `tsx {{.DEVDUCK_ROOT}}/scripts/install/run-step.ts ${stepId} --workspace-root {{.WORKSPACE_ROOT}} --project-root {{.DEVDUCK_ROOT}} --unattended`;

  return {
    version: '3',
    output: 'interleaved',
    vars: {
      DEVDUCK_ROOT: devduckPathRel,
      WORKSPACE_ROOT: '{{ default "." .WORKSPACE_ROOT }}'
    },
    tasks: {
      install: {
        desc: 'Run full installation sequence (Steps 1–7)',
        cmds: [
          { task: 'install:1-check-env' },
          { task: 'install:2-download-repos' },
          { task: 'install:3-download-projects' },
          { task: 'install:4-check-env-again' },
          { task: 'install:5-setup-modules' },
          { task: 'install:6-setup-projects' },
          { task: 'install:7-verify-installation' }
        ]
      },
      'install:1-check-env': { desc: 'Verify required environment variables', cmds: [stepCmd('check-env')] },
      'install:2-download-repos': { desc: 'Download external module repositories', cmds: [stepCmd('download-repos')] },
      'install:3-download-projects': { desc: 'Clone/link workspace projects', cmds: [stepCmd('download-projects')] },
      'install:4-check-env-again': { desc: 'Re-check environment variables', cmds: [stepCmd('check-env-again')] },
      'install:5-setup-modules': { desc: 'Setup all DevDuck modules', cmds: [stepCmd('setup-modules')] },
      'install:6-setup-projects': { desc: 'Setup all workspace projects', cmds: [stepCmd('setup-projects')] },
      'install:7-verify-installation': { desc: 'Verify installation correctness', cmds: [stepCmd('verify-installation')] }
    }
  };
}

export function buildGeneratedTaskfileFromWorkspaceConfig(params: {
  config: WorkspaceConfigLike;
  devduckPathRel: string;
}): GeneratedTaskfile {
  const { config, devduckPathRel } = params;
  const taskfile = (config as { taskfile?: unknown }).taskfile;
  if (!isPlainObject(taskfile)) return buildDefaultGeneratedTaskfile(devduckPathRel);

  const tasks = (taskfile as { tasks?: unknown }).tasks;
  if (!isPlainObject(tasks)) return buildDefaultGeneratedTaskfile(devduckPathRel);

  const varsFromConfig = coerceStringMap((taskfile as { vars?: unknown }).vars);

  // Always inject/ensure required vars.
  const vars: Record<string, string> = {
    ...varsFromConfig,
    DEVDUCK_ROOT: devduckPathRel,
    WORKSPACE_ROOT: '{{ default "." .WORKSPACE_ROOT }}'
  };

  return {
    version: '3',
    output: 'interleaved',
    vars,
    tasks
  };
}

