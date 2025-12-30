#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { initProviderContract } from '../../src/lib/provider-router.js';
import { installerTools } from './spec.js';
import { findWorkspaceRoot } from '../../src/lib/workspace-root.js';
import { installWithProvider, pickProviderForSrc } from '../../src/lib/extension/installer-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The moduleDir is the directory that contains built-in extensions (projects/barducks/src).
// Here we are at projects/barducks/extensions/installer/api.ts -> projects/barducks/src.
const moduleDir = path.resolve(__dirname, '../../src');

const t = initProviderContract<null>();

export const installerRouter = t.router({
  pickProviderForSrc: t.procedure
    .input(installerTools.pickProviderForSrc.input)
    .output(installerTools.pickProviderForSrc.output)
    .meta(installerTools.pickProviderForSrc.meta as any)
    .handler(async ({ input }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      const provider = await pickProviderForSrc({ src: input.src, kind: 'project', workspaceRoot, moduleDir, quiet: true });
      return { provider };
    }),

  install: t.procedure
    .input(installerTools.install.input)
    .output(installerTools.install.output)
    .meta(installerTools.install.meta as any)
    .handler(async ({ input }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      const { provider } = await installWithProvider({
        src: input.src,
        dest: input.dest,
        kind: 'project',
        force: input.force,
        workspaceRoot,
        moduleDir,
        quiet: true
      });
      return { ok: true as const, provider };
    })
});

// Legacy default export support (optional)
export default installerRouter;

