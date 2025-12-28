#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import YAML from 'yaml';
import { readWorkspaceConfigFromRoot, writeWorkspaceConfigFile } from './lib/workspace-config.js';

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

type GeneratedTaskfile = {
  version: string;
  output?: string;
  vars?: Record<string, string>;
  tasks: Record<string, unknown>;
};

function readYamlIfExists<T>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return YAML.parse(raw) as T;
  } catch {
    return null;
  }
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
      install: 'tsx ./devduck/src/scripts/install.ts --workspace-path . --unattended'
    },
    dependencies: {
      // Taskfile runner (go-task) to support `npx task install`
      '@go-task/cli': '^3.46.4',
      // Needed by DevDuck installer/runtime (imported from devduck/src/scripts/*)
      '@modelcontextprotocol/sdk': '^1.25.1',
      'compare-versions': '^6.1.1',
      dotenv: '^16.4.7',
      tsx: '^4.19.0',
      yaml: '^2.8.1',
      yargs: '^18.0.0',
      zod: '^3.25.76'
    }
  };

  fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function runNpmInstall(workspaceRoot: string): void {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const stdio =
    process.env.NODE_ENV === 'test' ? ('pipe' as const) : ('inherit' as const);

  const res = spawnSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio
  });

  if (res.status !== 0) {
    const details = (res.stderr || res.stdout || '').toString().trim();
    throw new Error(`npm install failed (exit ${res.status ?? 'unknown'}). ${details}`);
  }
}

function ensureWorkspaceTaskfile(workspaceRoot: string, devduckPathRel: string): void {
  const taskfilePath = path.join(workspaceRoot, 'Taskfile.yml');
  if (fs.existsSync(taskfilePath)) return;

  // Keep this file tiny and stable: it delegates to DevDuck's default taskfile.
  const includePath = path.posix.join(devduckPathRel.replace(/\\/g, '/'), 'defaults', 'install.taskfile.yml');
  const content =
    `version: '3'\n` +
    `output: interleaved\n\n` +
    `includes:\n` +
    `  devduck:\n` +
    `    taskfile: ${includePath}\n\n` +
    `tasks:\n` +
    `  sync:\n` +
    `    desc: "Generate .cache/taskfile.generated.yml from workspace config"\n` +
    `    cmds:\n` +
    `      - task: devduck:sync\n\n` +
    `  install:\n` +
    `    desc: "Run full installation sequence (Steps 1–7)"\n` +
    `    cmds:\n` +
    `      - task: devduck:install\n`;

  fs.writeFileSync(taskfilePath, content, 'utf8');
}

function buildGeneratedTaskfile(devduckPathRel: string): GeneratedTaskfile {
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
  // Avoid fs.cpSync: it can hit Node internal assertions on some Node versions.
  // This is a small, predictable copy tailored for "copy this repo into workspace/devduck/src".
  const skipDirNames = new Set(['node_modules', '.cache']);

  function copyEntry(src: string, dest: string): void {
    const st = fs.lstatSync(src);
    // Skip special files (e.g. unix sockets) that can exist in runtime caches.
    if (st.isSocket() || st.isFIFO()) return;
    if (st.isSymbolicLink()) {
      const link = fs.readlinkSync(src);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        fs.unlinkSync(dest);
      } catch {
        // ignore
      }
      fs.symlinkSync(link, dest);
      return;
    }
    if (st.isDirectory()) {
      if (skipDirNames.has(path.basename(src))) return;
      fs.mkdirSync(dest, { recursive: true });
      for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (skipDirNames.has(ent.name)) continue;
        copyEntry(path.join(src, ent.name), path.join(dest, ent.name));
      }
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  copyEntry(srcDir, destDir);
}

function cloneGitRepoSync(repoUrl: string, destDir: string, ref?: string): void {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });

  const args = ['clone', repoUrl, destDir];
  const clone = spawnSync('git', args, { stdio: 'inherit' });
  if (clone.status !== 0) {
    throw new Error(`git clone failed with exit code ${clone.status ?? 'unknown'}`);
  }

  if (ref) {
    const checkout = spawnSync('git', ['checkout', ref], { stdio: 'inherit', cwd: destDir });
    if (checkout.status !== 0) {
      throw new Error(`git checkout ${ref} failed with exit code ${checkout.status ?? 'unknown'}`);
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
      'sync [workspacePath]',
      'Generate .cache/taskfile.generated.yml (Taskfile runtime) for a workspace',
      (yy) =>
        yy.positional('workspacePath', {
          type: 'string',
          describe: 'Workspace root directory (defaults to current directory)',
          default: '.'
        }),
      (args) => {
        const invocationCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
        const workspaceRoot = path.resolve(invocationCwd, String(args.workspacePath || '.'));

        const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfigLike>(workspaceRoot);
        if (!config) {
          throw new Error(`Cannot read workspace config: ${configFile}`);
        }

        const devduckPathRel =
          typeof config.devduckPath === 'string' && config.devduckPath.trim().length > 0
            ? config.devduckPath.trim()
            : './devduck/src';

        const cacheDir = path.join(workspaceRoot, '.cache');
        fs.mkdirSync(cacheDir, { recursive: true });

        const generated = buildGeneratedTaskfile(devduckPathRel);
        const generatedPath = path.join(cacheDir, 'taskfile.generated.yml');
        const out = YAML.stringify(generated);
        fs.writeFileSync(generatedPath, out.endsWith('\n') ? out : out + '\n', 'utf8');

        ensureWorkspaceTaskfile(workspaceRoot, devduckPathRel);

        // eslint-disable-next-line no-console
        console.log(`Generated ${path.relative(workspaceRoot, generatedPath)} from ${path.basename(configFile)}`);
      }
    )
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
            describe: 'Path to a template workspace.config.yml to start from'
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

        const configPath = path.join(workspaceRoot, 'workspace.config.yml');
        const templatePath = args['workspace-config']
          ? path.resolve(invocationCwd, String(args['workspace-config']))
          : null;

        const templateCfg = templatePath ? readYamlIfExists<WorkspaceConfigLike>(templatePath) : null;
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

        writeWorkspaceConfigFile(configPath, config);

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

