#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { execCmdSync } from './lib/process.js';

type WorkspaceConfigLike = {
  workspaceVersion?: string;
  devduckPath?: string;
  modules?: string[];
  moduleSettings?: Record<string, unknown>;
  repos?: string[];
  projects?: Array<{ src?: string } & Record<string, unknown>>;
  checks?: unknown[];
  env?: unknown[];
  [k: string]: unknown;
};

function readJsonIfExists<T>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function ensureWorkspacePackageJson(workspaceRoot: string): void {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgPath)) return;

  // Keep dependencies minimal: only what's needed to run DevDuck installer via TSX.
  // Avoid pulling the DevDuck npm package itself to prevent heavy postinstall steps.
  const pkg = {
    name: path.basename(workspaceRoot) || 'devduck-workspace',
    private: true,
    type: 'module',
    scripts: {
      // This runs automatically on `npm install` and bootstraps the workspace.
      install: 'tsx ./devduck/src/install.ts --workspace-path . --unattended'
    },
    dependencies: {
      dotenv: '^16.4.7',
      execa: '^9.6.1',
      tsx: '^4.19.0',
      yaml: '^2.8.1',
      yargs: '^18.0.0',
      zod: '^3.25.76'
    }
  };

  writeJson(pkgPath, pkg);
}

function runNpmInstall(workspaceRoot: string): void {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const stdio =
    process.env.NODE_ENV === 'test' ? ('pipe' as const) : ('inherit' as const);

  const res = execCmdSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
    cwd: workspaceRoot,
    stdio
  });

  if (res.exitCode !== 0) {
    const details = (res.stderr || res.stdout || '').toString().trim();
    throw new Error(`npm install failed (exit ${res.exitCode}). ${details}`);
  }
}

function isDevduckProjectSrc(src: string): boolean {
  const s = src.trim();

  // github.com/<org>/devduck or https://github.com/<org>/devduck(.git)
  if (/github\.com/i.test(s) && /\/devduck(\.git)?$/i.test(s)) return true;

  // git@github.com:<org>/devduck(.git)
  if (/git@github\.com:/i.test(s) && /\/devduck(\.git)?$/i.test(s.replace(':', '/'))) return true;

  // local paths: .../devduck or .../devduck/src
  const norm = path.posix.normalize(s.replace(/\\/g, '/'));
  if (norm.endsWith('/devduck') || norm.endsWith('/devduck/src')) return true;

  return false;
}

function configListsDevduckAsProject(config: WorkspaceConfigLike | null): boolean {
  const projects = config?.projects;
  if (!Array.isArray(projects) || projects.length === 0) return false;
  return projects.some((p) => typeof p?.src === 'string' && isDevduckProjectSrc(p.src));
}

function copyDirSync(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    // avoid copying nested node_modules if present in a source checkout
    filter: (p) => !p.includes(`${path.sep}node_modules${path.sep}`)
  });
}

function cloneGitRepoSync(repoUrl: string, destDir: string, ref?: string): void {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });

  const args = ['clone', repoUrl, destDir];
  const clone = execCmdSync('git', args, { stdio: 'inherit' });
  if (clone.exitCode !== 0) {
    throw new Error(`git clone failed with exit code ${clone.exitCode}`);
  }

  if (ref) {
    const checkout = execCmdSync('git', ['checkout', ref], { stdio: 'inherit', cwd: destDir });
    if (checkout.exitCode !== 0) {
      throw new Error(`git checkout ${ref} failed with exit code ${checkout.exitCode}`);
    }
  }
}

function ensureDevduckInWorkspace(params: {
  workspaceRoot: string;
  config: WorkspaceConfigLike;
  devduckRepo: string;
  devduckRef?: string;
  devduckSource?: string;
}): WorkspaceConfigLike {
  const { workspaceRoot, devduckRepo, devduckRef, devduckSource } = params;
  const config = params.config;

  const devduckDest = path.join(workspaceRoot, 'devduck', 'src');
  const shouldMaterialize = !configListsDevduckAsProject(config);

  if (!shouldMaterialize) {
    return config;
  }

  if (!fs.existsSync(devduckDest)) {
    if (devduckSource) {
      copyDirSync(devduckSource, devduckDest);
    } else {
      cloneGitRepoSync(devduckRepo, devduckDest, devduckRef);
    }
  }

  if (!config.devduckPath) {
    config.devduckPath = './devduck/src';
  }

  return config;
}

function buildDefaultWorkspaceConfig(): WorkspaceConfigLike {
  return {
    workspaceVersion: '0.1.0',
    devduckPath: './devduck/src',
    modules: ['core', 'cursor'],
    moduleSettings: {},
    repos: [],
    projects: [],
    checks: [],
    env: []
  };
}

async function main(argv = process.argv): Promise<void> {
  const y = yargs(hideBin(argv))
    .scriptName('devduck')
    .command(
      'new <workspacePath>',
      'Create a new DevDuck workspace',
      (yy) =>
        yy
          .positional('workspacePath', {
            type: 'string',
            describe: 'Path to create the workspace in',
            demandOption: true
          })
          .option('workspace-config', {
            type: 'string',
            describe: 'Path to a template workspace.config.json to start from'
          })
          .option('devduck-repo', {
            type: 'string',
            describe: 'Git URL for DevDuck repository',
            default: 'https://github.com/holiber/devduck.git'
          })
          .option('devduck-ref', {
            type: 'string',
            describe: 'Optional git ref (branch/tag/sha) to checkout after clone'
          })
          .option('devduck-source', {
            type: 'string',
            describe:
              'Local folder to copy DevDuck from (no git clone). Intended for offline/CI tests.'
          }),
      (args) => {
        // When invoked via npm/npx, process.cwd() may point to a temporary package folder
        // (e.g. ~/.npm/_npx/.../node_modules/devduck). INIT_CWD is the directory where the user
        // ran the command from, so resolve relative paths from there.
        const invocationCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();

        const workspaceRoot = path.resolve(invocationCwd, String(args.workspacePath));
        fs.mkdirSync(workspaceRoot, { recursive: true });

        const configPath = path.join(workspaceRoot, 'workspace.config.json');
        const templatePath = args['workspace-config']
          ? path.resolve(invocationCwd, String(args['workspace-config']))
          : null;

        const templateCfg = templatePath ? readJsonIfExists<WorkspaceConfigLike>(templatePath) : null;
        const config: WorkspaceConfigLike = {
          ...buildDefaultWorkspaceConfig(),
          ...(templateCfg || {})
        };

        ensureDevduckInWorkspace({
          workspaceRoot,
          config,
          devduckRepo: String(args['devduck-repo']),
          devduckRef: args['devduck-ref'] ? String(args['devduck-ref']) : undefined,
          devduckSource: args['devduck-source']
            ? path.resolve(invocationCwd, String(args['devduck-source']))
            : undefined
        });

        writeJson(configPath, config);

        // Create workspace package.json and install dependencies.
        // `npm install` will automatically run the workspace "install" script, which bootstraps the workspace.
        ensureWorkspacePackageJson(workspaceRoot);
        runNpmInstall(workspaceRoot);
      }
    )
    .demandCommand(1)
    .strict()
    .help();

  await y.parseAsync();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error((e as Error)?.stack || (e as Error)?.message || String(e));
    process.exitCode = 1;
  });
}

export { main };

