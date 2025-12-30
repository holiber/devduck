import { loadInstallState, saveInstallState } from './install-state.js';
import type { InstallLogger } from './logger.js';

export type StepStatus = 'ok' | 'needs_input' | 'failed';

export type StepOutcome<T = unknown> = {
  status: StepStatus;
  result?: T;
  message?: string;
  error?: string;
};

export type InstallStepId =
  | 'check-env'
  | 'download-repos'
  | 'download-projects'
  | 'check-env-again'
  | 'setup-modules'
  | 'setup-projects'
  | 'verify-installation';

export type InstallContext = {
  workspaceRoot: string;
  projectRoot: string;
  config: unknown;
  autoYes: boolean;
  logger: InstallLogger;
};

export type InstallStep<T = unknown> = {
  id: InstallStepId;
  title: string;
  description?: string;
  run: (ctx: InstallContext) => Promise<StepOutcome<T>>;
};

export type RunInstallResult =
  | { status: 'completed' }
  | { status: 'paused'; stepId: InstallStepId; message?: string }
  | { status: 'failed'; stepId: InstallStepId; error: string };

export async function runInstall(steps: InstallStep[], ctx: InstallContext): Promise<RunInstallResult> {
  const state = loadInstallState(ctx.workspaceRoot);

  ctx.logger.info({ workspaceRoot: ctx.workspaceRoot }, 'install.start');

  for (const [idx, step] of steps.entries()) {
    const stepNum = idx + 1;
    ctx.logger.info({ stepId: step.id, stepNum, title: step.title }, 'install.step.start');

    let outcome: StepOutcome;
    try {
      outcome = await step.run(ctx);
    } catch (e) {
      const err = e as Error;
      outcome = { status: 'failed', error: err?.message || String(e) };
    }

    // Persist step result
    // Special case: allow steps to return `{ installedModules }` and persist it at the top-level state.
    if (
      step.id === 'setup-modules' &&
      outcome.status === 'ok' &&
      outcome.result &&
      typeof outcome.result === 'object' &&
      !Array.isArray(outcome.result) &&
      'installedModules' in (outcome.result as Record<string, unknown>)
    ) {
      const installedModules = (outcome.result as Record<string, unknown>).installedModules;
      if (installedModules && typeof installedModules === 'object' && !Array.isArray(installedModules)) {
        state.installedModules = installedModules as Record<string, string>;
      }
    }

    state.steps[step.id] = {
      completed: outcome.status !== 'failed',
      completedAt: new Date().toISOString(),
      result: outcome.result,
      error: outcome.status === 'failed' ? outcome.error : undefined
    };
    saveInstallState(ctx.workspaceRoot, state);

    if (outcome.status === 'ok') {
      ctx.logger.info({ stepId: step.id, stepNum }, 'install.step.ok');
      continue;
    }

    if (outcome.status === 'needs_input') {
      ctx.logger.warn({ stepId: step.id, stepNum, message: outcome.message }, 'install.step.needs_input');
      return { status: 'paused', stepId: step.id, message: outcome.message };
    }

    ctx.logger.error({ stepId: step.id, stepNum, error: outcome.error }, 'install.step.failed');
    return { status: 'failed', stepId: step.id, error: outcome.error || 'Unknown error' };
  }

  state.installedAt = new Date().toISOString();
  saveInstallState(ctx.workspaceRoot, state);
  ctx.logger.info('install.completed');

  return { status: 'completed' };
}


