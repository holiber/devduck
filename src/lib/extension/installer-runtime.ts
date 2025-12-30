import path from 'path';
import { fileURLToPath } from 'url';

import { ensureProvidersDiscovered } from './provider-runtime.js';
import { getProvider, getProvidersByType, type ProviderBase } from './provider-registry.js';
import { getInstalledSource, setInstalledSource } from '../../install/install-state.js';

export type InstallKind = 'project' | 'repo';

type InstallerProvider = ProviderBase & {
  isValidSrc?: (input: { src: string }) => Promise<boolean> | boolean;
  install?: (input: { src: string; dest: string; force?: boolean }) => Promise<unknown>;
};

function getDefaultModuleDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // .../src/lib/extension -> .../src
  return path.resolve(__dirname, '../..');
}

function preferOrderForKind(kind: InstallKind): string[] {
  // Deterministic provider choice without embedding git logic into fs-provider.
  // Providers still decide via isValidSrc.
  if (kind === 'repo') {
    return ['installer-arc-provider', 'installer-git-provider', 'installer-fs-provider'];
  }
  return ['installer-arc-provider', 'installer-git-provider', 'installer-fs-provider'];
}

async function discoverInstallerProviders(args: {
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
  kind: InstallKind;
  workspaceRoot: string | null;
  moduleDir?: string;
  quiet?: boolean;
}): Promise<string> {
  const providers = await discoverInstallerProviders(args);
  const order = preferOrderForKind(args.kind);

  const byName = new Map(providers.map((p) => [String(p.name || '').trim(), p]));
  const candidates: InstallerProvider[] = [];
  for (const name of order) {
    const p = byName.get(name);
    if (p) candidates.push(p);
  }
  for (const p of providers) {
    if (!candidates.includes(p)) candidates.push(p);
  }

  for (const p of candidates) {
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
  kind: InstallKind;
  force?: boolean;
  workspaceRoot: string | null;
  moduleDir?: string;
  quiet?: boolean;
}): Promise<{ provider: string }> {
  const destAbs = path.resolve(String(args.dest || '').trim());
  const src = String(args.src || '').trim();
  const kind = args.kind;
  const force = !!args.force;

  if (!src) throw new Error('installer: src is required');
  if (!destAbs) throw new Error('installer: dest is required');

  // Provider pinning via install-state.json (when running inside a workspace install).
  const pinned = args.workspaceRoot ? getInstalledSource(args.workspaceRoot, destAbs) : null;
  if (pinned && pinned.provider && !force) {
    const p = getProvider('installer', pinned.provider) as InstallerProvider | null;
    const fn = p && p.install;
    if (p && typeof fn === 'function') {
      await fn({ src, dest: destAbs, force });
      return { provider: pinned.provider };
    }
  }

  const providers = await discoverInstallerProviders(args);
  const order = preferOrderForKind(kind);
  const byName = new Map(providers.map((p) => [String(p.name || '').trim(), p]));
  const candidates: InstallerProvider[] = [];
  for (const name of order) {
    const p = byName.get(name);
    if (p) candidates.push(p);
  }
  for (const p of providers) {
    if (!candidates.includes(p)) candidates.push(p);
  }

  for (const p of candidates) {
    const isValidSrc = p.isValidSrc;
    const install = p.install;
    if (typeof isValidSrc !== 'function' || typeof install !== 'function') continue;
    const ok = await isValidSrc({ src });
    if (!ok) continue;

    const providerName = String(p.name || p.manifest?.name || '').trim() || 'unknown';
    await install({ src, dest: destAbs, force });

    if (args.workspaceRoot) {
      setInstalledSource(args.workspaceRoot, {
        src,
        dest: destAbs,
        provider: providerName,
        kind,
        installedAt: new Date().toISOString()
      });
    }

    return { provider: providerName };
  }

  throw new Error(`installer: no provider found for src: ${src}`);
}

