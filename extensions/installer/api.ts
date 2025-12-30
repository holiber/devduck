#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { initProviderContract } from '../../src/lib/provider-router.js';
import { findWorkspaceRoot } from '../../src/lib/workspace-root.js';
import { installWithProvider, pickProviderForSrc } from '../../src/lib/extension/installer-runtime.js';
import {
  InstallerInstallInputSchema,
  InstallerInstallOutputSchema,
  InstallerPickProviderInputSchema,
  InstallerPickProviderOutputSchema
} from './schemas/contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The moduleDir is the directory that contains built-in extensions (projects/barducks/src).
// Here we are at projects/barducks/extensions/installer/api.ts -> projects/barducks/src.
const moduleDir = path.resolve(__dirname, '../../src');

const t = initProviderContract<null>();

export const installerRouter = t.router({
  pickProviderForSrc: t.procedure
    .input(InstallerPickProviderInputSchema)
    .output(InstallerPickProviderOutputSchema)
    .meta({
      title: 'Pick installer provider for src',
      description: 'Returns provider name that can handle given src, or empty string if none.',
      idempotent: true,
      timeoutMs: 5_000,
      examples: [{ command: 'api-cli installer.pickProviderForSrc --src ./projects/my-project' }]
    } as any)
    .handler(async ({ input }) => {
      const workspaceRoot = findWorkspaceRoot(process.cwd());
      const provider = await pickProviderForSrc({ src: input.src, kind: 'project', workspaceRoot, moduleDir, quiet: true });
      return { provider };
    }),

  install: t.procedure
    .input(InstallerInstallInputSchema)
    .output(InstallerInstallOutputSchema)
    .meta({
      title: 'Install src into dest using a suitable installer provider',
      description: 'Finds a provider that can handle src and installs it into dest. Errors if no provider found.',
      idempotent: false,
      timeoutMs: 60_000,
      examples: [{ command: 'api-cli installer.install --src ./projects/my-project --dest /tmp/my-project' }]
    } as any)
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

