import path from 'path';
import { fileURLToPath } from 'url';

import { ensureProvidersDiscovered } from '../../../src/lib/api-cli/provider-runtime.js';
import { getProvidersByType, type ProviderBase } from '../../../src/lib/provider-registry.js';

type InstallerProvider = ProviderBase & {
  isValidSrc?: (input: { src: string }) => Promise<boolean> | boolean;
  install?: (input: { src: string; dest: string; force?: boolean }) => Promise<unknown>;
};

function getDefaultModuleDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // .../extensions/installer/lib -> .../projects/barducks/src
  return path.resolve(__dirname, '../../../src');
}

export async function discoverInstallerProviders(args: {
  workspaceRoot: string | null;
  moduleDir?: string;
  quiet?: boolean;
}): Promise<InstallerProvider[]> {
  const moduleDir = args.moduleDir || getDefaultModuleDir();
  await ensureProvidersDiscovered(args.workspaceRoot, moduleDir, !!args.quiet);
  return getProvidersByType('installer') as InstallerProvider[];
}

export async function pickProviderForSrc(args: {
  src: string;
  workspaceRoot: string | null;
  moduleDir?: string;
  quiet?: boolean;
}): Promise<string> {
  const providers = await discoverInstallerProviders(args);
  for (const p of providers) {
    const fn = p.isValidSrc;
    if (typeof fn !== 'function') continue;
    const ok = await fn({ src: args.src });
    if (ok) return String(p.name || p.manifest?.name || '').trim();
  }
  return '';
}

export async function installWithProvider(args: {
  src: string;
  dest: string;
  force?: boolean;
  workspaceRoot: string | null;
  moduleDir?: string;
  quiet?: boolean;
}): Promise<{ provider: string }> {
  const providers = await discoverInstallerProviders(args);

  for (const p of providers) {
    const isValidSrc = p.isValidSrc;
    const install = p.install;
    if (typeof isValidSrc !== 'function' || typeof install !== 'function') continue;

    const ok = await isValidSrc({ src: args.src });
    if (!ok) continue;

    const providerName = String(p.name || p.manifest?.name || '').trim();
    await install({ src: args.src, dest: args.dest, force: !!args.force });
    return { provider: providerName || 'unknown' };
  }

  throw new Error(`installer: no provider found for src: ${args.src}`);
}

