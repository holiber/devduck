import type { ProviderManifestBase, ProviderType } from './provider-registry.js';

export type DefineProviderArgs<
  TType extends ProviderType,
  TTools extends Record<string, unknown>,
  TVendor extends Record<string, Record<string, unknown>> | undefined = undefined
> = {
  type: TType;
  name: string;
  version: string;
  protocolVersion: string;
  tools: TTools;
  vendor?: TVendor;
  auth?: unknown;
  capabilities?: string[];
  manifest?: Partial<ProviderManifestBase>;
};

/**
 * Define a provider in a declarative way.
 *
 * Goals:
 * - `manifest.tools` is derived from `tools` keys (single source of truth)
 * - `manifest.vendorTools` is derived from `vendor` keys (namespaces + methods)
 * - `tools` are available both under `provider.tools.*` and as flattened methods (`provider.fetchPR(...)`)
 *
 * NOTE: Flattened methods are kept for backward compatibility with existing providers/tests.
 */
export function defineProvider<
  const TType extends ProviderType,
  const TTools extends Record<string, unknown>,
  const TVendor extends Record<string, Record<string, unknown>> | undefined = undefined
>(args: DefineProviderArgs<TType, TTools, TVendor>) {
  const toolsList = Object.keys(args.tools);

  const vendorTools: Record<string, string[]> = {};
  if (args.vendor) {
    for (const [ns, methods] of Object.entries(args.vendor)) {
      vendorTools[ns] = Object.keys(methods || {});
    }
  }

  const manifest: ProviderManifestBase = {
    ...(args.manifest || {}),
    type: args.type,
    name: args.name,
    version: args.version,
    protocolVersion: args.protocolVersion,
    tools: toolsList,
    vendorTools,
    auth: (args as { auth?: unknown }).auth ?? { type: 'none', requiredTokens: [] },
    capabilities: (args as { capabilities?: string[] }).capabilities ?? []
  };

  const provider = {
    name: args.name,
    version: args.version,
    manifest,
    tools: args.tools,
    vendor: (args.vendor || {}) as NonNullable<TVendor>
  } as const;

  // Backward-compatible flattened tool methods: provider.fetchPR(...) etc
  return {
    ...provider,
    ...(args.tools as object)
  } as typeof provider & TTools;
}

