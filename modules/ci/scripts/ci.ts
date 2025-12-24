#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createYargs, installEpipeHandler } from '../../../scripts/lib/cli.js';
import { readJSON } from '../../../scripts/lib/config.js';
import { resolveDevduckRoot } from '../../../scripts/lib/devduck-paths.js';
import { findWorkspaceRoot } from '../../../scripts/lib/workspace-root.js';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider,
  setProviderTypeSchema
} from '../../../scripts/lib/provider-registry.js';
import type { CIProvider, PRInfo, CheckStatus, Comment, FetchPRInput, FetchCheckStatusInput, FetchCommentsInput } from '../schemas/contract.js';
import { CIProviderSchema } from '../schemas/contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkspaceConfigLike = {
  moduleSettings?: Record<string, unknown>;
};

function asCIProvider(p: unknown): CIProvider {
  return p as CIProvider;
}

function pickProviderNameFromConfig(workspaceRoot: string | null): string | null {
  const envName = (process.env.CI_PROVIDER || '').trim();
  if (envName) return envName;

  const root = workspaceRoot || findWorkspaceRoot(process.cwd());
  if (!root) return null;

  const configPath = path.join(root, 'workspace.config.json');
  if (!fs.existsSync(configPath)) return null;

  const cfg = readJSON<WorkspaceConfigLike>(configPath);
  const moduleSettings = (cfg && cfg.moduleSettings) || {};
  const ciSettings = (moduleSettings as Record<string, unknown>).ci as Record<string, unknown> | undefined;
  const name = ciSettings && typeof ciSettings.provider === 'string' ? ciSettings.provider : '';
  return name.trim() || null;
}

function formatPRInfo(pr: PRInfo): string {
  const lines: string[] = [];
  lines.push(`PR #${pr.number || pr.id}: ${pr.title || 'N/A'}`);
  lines.push(`Status: ${pr.status || pr.state || 'N/A'}`);
  if (pr.branch) {
    lines.push(`Branch: ${pr.branch.from || 'N/A'} → ${pr.branch.to || pr.branch.base || 'N/A'}`);
  }
  lines.push(`Comments: ${pr.commentCount}`);
  if (pr.mergeCheckStatus) {
    const { checksTotal, checksPassed, checksFailed, checksPending, canMerge } = pr.mergeCheckStatus;
    lines.push(`Checks: ${checksTotal} total (${checksPassed} passed, ${checksFailed} failed, ${checksPending} pending)`);
    lines.push(`Can merge: ${canMerge ? 'Yes' : 'No'}`);
  }
  if (pr.reviewers && pr.reviewers.length > 0) {
    lines.push(`Reviewers: ${pr.reviewers.map((r) => `${r.login} (${r.state || 'pending'})`).join(', ')}`);
  }
  if (pr.url) {
    lines.push(`URL: ${pr.url}`);
  }
  return lines.join('\n');
}

function formatCheckStatus(checks: CheckStatus[]): string {
  if (checks.length === 0) {
    return 'No checks found';
  }

  const lines: string[] = [];
  lines.push(`Checks (${checks.length}):`);
  for (const check of checks) {
    const status = check.conclusion || check.status;
    const icon = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⏳';
    lines.push(`  ${icon} ${check.name}: ${status}`);
    if (check.url) {
      lines.push(`    URL: ${check.url}`);
    }
    if (check.failureReason) {
      lines.push(`    Reason: ${check.failureReason}`);
    }
    if (check.annotations && check.annotations.length > 0) {
      lines.push(`    Annotations: ${check.annotations.length}`);
      for (const ann of check.annotations.slice(0, 3)) {
        const location = ann.path ? `${ann.path}:${ann.startLine || ''}` : '';
        lines.push(`      - ${location ? `${location}: ` : ''}${ann.message}`);
      }
      if (check.annotations.length > 3) {
        lines.push(`      ... and ${check.annotations.length - 3} more`);
      }
    }
  }
  return lines.join('\n');
}

function formatComments(comments: Comment[]): string {
  if (comments.length === 0) {
    return 'No comments found';
  }

  const lines: string[] = [];
  lines.push(`Comments (${comments.length}):`);
  for (const comment of comments) {
    const location = comment.path && comment.line ? `${comment.path}:${comment.line}` : '';
    lines.push(`  ${comment.author.login}${location ? ` (${location})` : ''}:`);
    lines.push(`    ${comment.body}`);
    if (comment.reactions && comment.reactions.length > 0) {
      const reactions = comment.reactions.map((r) => `${r.type} (${r.count})`).join(', ');
      lines.push(`    Reactions: ${reactions}`);
    }
    if (comment.isResolved) {
      lines.push(`    [Resolved]`);
    }
  }
  return lines.join('\n');
}

async function main(argv = process.argv): Promise<void> {
  installEpipeHandler();

  await createYargs(argv)
    .scriptName('ci')
    .strict()
    .usage('Usage: $0 <command> [options]')
    .command(
      'pr <prId|branch>',
      'Fetch PR information',
      (yargs: ReturnType<typeof createYargs>) => {
        return yargs
          .positional('prId', {
            type: 'string',
            describe: 'PR ID or branch name'
          })
          .option('provider', { type: 'string', describe: 'Provider name (overrides config/env)', default: '' })
          .option('json', { type: 'boolean', describe: 'Output JSON instead of formatted text', default: false });
      },
      async (args: { prId?: string; provider?: string; json?: boolean }) => {
        const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });
        const workspaceRoot = findWorkspaceRoot(process.cwd());

        setProviderTypeSchema('ci', CIProviderSchema);
        
        // Discover providers from devduck modules
        await discoverProvidersFromModules({ modulesDir: path.join(devduckRoot, 'modules') });
        
        // Also discover providers from external repositories (projects from workspace)
        if (workspaceRoot) {
          const externalModulesDirs = [
            path.join(workspaceRoot, 'projects', 'devduck-ya-modules', 'modules'),
            path.join(workspaceRoot, 'devduck-ya-modules', 'modules')
          ];
          for (const modulesDir of externalModulesDirs) {
            if (fs.existsSync(modulesDir)) {
              await discoverProvidersFromModules({ modulesDir });
            }
          }
        }

        const providers = getProvidersByType('ci');
        if (providers.length === 0) {
          throw new Error('No CI providers discovered');
        }

        const explicit = String(args.provider || '').trim();
        const configured = pickProviderNameFromConfig(workspaceRoot);
        const selectedName = explicit || configured || providers[0].name;

        const selected = getProvider('ci', selectedName);
        const provider = selected ? asCIProvider(selected) : asCIProvider(providers[0]);

        const prId = args.prId as string;
        const input: FetchPRInput = prId.match(/^\d+$/) ? { prId: Number.parseInt(prId, 10) } : { branch: prId };

        const pr = (await provider.fetchPR(input)) as PRInfo;

        if (args.json) {
          process.stdout.write(JSON.stringify({ provider: provider.name, pr }, null, 2));
          if (!process.stdout.isTTY) process.stdout.write('\n');
          return;
        }

        process.stdout.write(`Provider: ${provider.name}\n\n`);
        process.stdout.write(formatPRInfo(pr));
        process.stdout.write('\n');
      }
    )
    .command(
      'checks <prId|branch>',
      'Fetch check status with annotations',
      (yargs: ReturnType<typeof createYargs>) => {
        return yargs
          .positional('prId', {
            type: 'string',
            describe: 'PR ID or branch name'
          })
          .option('provider', { type: 'string', describe: 'Provider name (overrides config/env)', default: '' })
          .option('checkId', { type: 'string', describe: 'Specific check ID (optional)' })
          .option('json', { type: 'boolean', describe: 'Output JSON instead of formatted text', default: false });
      },
      async (args: { prId?: string; provider?: string; checkId?: string; json?: boolean }) => {
        const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });
        const workspaceRoot = findWorkspaceRoot(process.cwd());

        setProviderTypeSchema('ci', CIProviderSchema);
        
        // Discover providers from devduck modules
        await discoverProvidersFromModules({ modulesDir: path.join(devduckRoot, 'modules') });
        
        // Also discover providers from external repositories (projects from workspace)
        if (workspaceRoot) {
          const externalModulesDirs = [
            path.join(workspaceRoot, 'projects', 'devduck-ya-modules', 'modules'),
            path.join(workspaceRoot, 'devduck-ya-modules', 'modules')
          ];
          for (const modulesDir of externalModulesDirs) {
            if (fs.existsSync(modulesDir)) {
              await discoverProvidersFromModules({ modulesDir });
            }
          }
        }

        const providers = getProvidersByType('ci');
        if (providers.length === 0) {
          throw new Error('No CI providers discovered');
        }

        const explicit = String(args.provider || '').trim();
        const configured = pickProviderNameFromConfig(workspaceRoot);
        const selectedName = explicit || configured || providers[0].name;

        const selected = getProvider('ci', selectedName);
        const provider = selected ? asCIProvider(selected) : asCIProvider(providers[0]);

        const prId = args.prId as string;
        const input: FetchCheckStatusInput = prId.match(/^\d+$/)
          ? { prId: Number.parseInt(prId, 10) }
          : { branch: prId };
        if (args.checkId) {
          (input as FetchCheckStatusInput).checkId = args.checkId as string;
        }

        const checks = (await provider.fetchCheckStatus(input)) as CheckStatus[];

        if (args.json) {
          process.stdout.write(JSON.stringify({ provider: provider.name, checks }, null, 2));
          if (!process.stdout.isTTY) process.stdout.write('\n');
          return;
        }

        process.stdout.write(`Provider: ${provider.name}\n\n`);
        process.stdout.write(formatCheckStatus(checks));
        process.stdout.write('\n');
      }
    )
    .command(
      'comments <prId|branch>',
      'Fetch PR comments and reactions',
      (yargs: ReturnType<typeof createYargs>) => {
        return yargs
          .positional('prId', {
            type: 'string',
            describe: 'PR ID or branch name'
          })
          .option('provider', { type: 'string', describe: 'Provider name (overrides config/env)', default: '' })
          .option('json', { type: 'boolean', describe: 'Output JSON instead of formatted text', default: false });
      },
      async (args: { prId?: string; provider?: string; json?: boolean }) => {
        const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });
        const workspaceRoot = findWorkspaceRoot(process.cwd());

        setProviderTypeSchema('ci', CIProviderSchema);
        
        // Discover providers from devduck modules
        await discoverProvidersFromModules({ modulesDir: path.join(devduckRoot, 'modules') });
        
        // Also discover providers from external repositories (projects from workspace)
        if (workspaceRoot) {
          const externalModulesDirs = [
            path.join(workspaceRoot, 'projects', 'devduck-ya-modules', 'modules'),
            path.join(workspaceRoot, 'devduck-ya-modules', 'modules')
          ];
          for (const modulesDir of externalModulesDirs) {
            if (fs.existsSync(modulesDir)) {
              await discoverProvidersFromModules({ modulesDir });
            }
          }
        }

        const providers = getProvidersByType('ci');
        if (providers.length === 0) {
          throw new Error('No CI providers discovered');
        }

        const explicit = String(args.provider || '').trim();
        const configured = pickProviderNameFromConfig(workspaceRoot);
        const selectedName = explicit || configured || providers[0].name;

        const selected = getProvider('ci', selectedName);
        const provider = selected ? asCIProvider(selected) : asCIProvider(providers[0]);

        const prId = args.prId as string;
        const input: FetchCommentsInput = prId.match(/^\d+$/) ? { prId: Number.parseInt(prId, 10) } : { branch: prId };

        const comments = (await provider.fetchComments(input)) as Comment[];

        if (args.json) {
          process.stdout.write(JSON.stringify({ provider: provider.name, comments }, null, 2));
          if (!process.stdout.isTTY) process.stdout.write('\n');
          return;
        }

        process.stdout.write(`Provider: ${provider.name}\n\n`);
        process.stdout.write(formatComments(comments));
        process.stdout.write('\n');
      }
    )
    .demandCommand(1, 'You need at least one command before moving on')
    .help()
    .parseAsync();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    const err = e as { message?: string; stack?: string };
    // eslint-disable-next-line no-console
    console.error(err && err.stack ? err.stack : err.message || String(e));
    process.exitCode = 1;
  });
}

export { main };
