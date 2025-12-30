import { z } from 'zod';
import { defineTools, tool } from '../../src/lib/tool-spec.js';
import {
  InstallerInstallInputSchema,
  InstallerInstallOutputSchema,
  InstallerPickProviderInputSchema,
  InstallerPickProviderOutputSchema
} from './schemas/contract.js';

export const installerTools = defineTools({
  pickProviderForSrc: tool({
    input: InstallerPickProviderInputSchema,
    output: InstallerPickProviderOutputSchema,
    meta: {
      title: 'Pick installer provider for src',
      description: 'Returns provider name that can handle given src, or empty string if none.',
      idempotent: true,
      timeoutMs: 5_000,
      examples: [{ command: 'api-cli installer.pickProviderForSrc --src ./projects/my-project' }]
    }
  }),

  install: tool({
    input: InstallerInstallInputSchema,
    output: InstallerInstallOutputSchema,
    meta: {
      title: 'Install src into dest using a suitable installer provider',
      description: 'Finds a provider that can handle src and installs it into dest. Errors if no provider found.',
      idempotent: false,
      timeoutMs: 60_000,
      examples: [{ command: 'api-cli installer.install --src ./projects/my-project --dest /tmp/my-project' }]
    }
  })
} as const);

export const installerSpec = {
  name: 'installer',
  description: 'Unified installer for projects and repos (pluggable providers)',
  requiresProvider: false,
  tools: installerTools
} as const;

export default installerSpec;

