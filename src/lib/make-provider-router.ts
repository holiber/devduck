import { initProviderContract, type Procedure, type ProcedureMeta, type ProviderRouter } from './provider-router.js';
import type { ToolDef, ToolsSpec, VendorToolsSpec } from './tool-spec.js';

function toProcedureMeta(meta: ToolDef['meta'] | undefined): ProcedureMeta {
  return (meta || {}) as ProcedureMeta;
}

function getToolHandler(provider: unknown, toolName: string): ((input: unknown) => Promise<unknown>) | null {
  const p = provider as any;
  const toolsObj = p && typeof p === 'object' ? (p.tools as Record<string, unknown> | undefined) : undefined;
  const fn = (toolsObj && (toolsObj as any)[toolName]) || (p && (p as any)[toolName]);
  return typeof fn === 'function' ? (fn as (input: unknown) => Promise<unknown>) : null;
}

function getVendorToolHandler(
  provider: unknown,
  namespace: string,
  method: string
): ((input: unknown) => Promise<unknown>) | null {
  const p = provider as any;
  const vendorObj = p && typeof p === 'object' ? (p.vendor as Record<string, unknown> | undefined) : undefined;
  const nsObj = vendorObj && (vendorObj as any)[namespace];
  const fn = nsObj && (nsObj as any)[method];
  return typeof fn === 'function' ? (fn as (input: unknown) => Promise<unknown>) : null;
}

export function makeProviderRouter<
  TProvider = unknown,
  const TTools extends ToolsSpec = ToolsSpec,
  const TVendor extends VendorToolsSpec | undefined = undefined
>(args: {
  tools: TTools;
  vendorTools?: TVendor;
}): ProviderRouter<Record<string, Procedure<any, any, TProvider>>, TProvider> {
  const t = initProviderContract<TProvider>();

  const procedures: Record<string, Procedure<any, any, TProvider>> = {};

  for (const [toolName, def] of Object.entries(args.tools)) {
    procedures[toolName] = t.procedure
      .input(def.input)
      .output(def.output)
      .meta(toProcedureMeta(def.meta))
      .handler(async ({ input, ctx }) => {
        const fn = getToolHandler(ctx.provider, toolName);
        if (!fn) {
          throw new Error(`Provider does not implement tool '${toolName}'`);
        }
        return await fn(input);
      });
  }

  if (args.vendorTools) {
    for (const [namespace, vendorTools] of Object.entries(args.vendorTools)) {
      for (const [method, def] of Object.entries(vendorTools)) {
        const procedurePath = `vendor.${namespace}.${method}`;
        procedures[procedurePath] = t.procedure
          .input(def.input)
          .output(def.output)
          .meta(toProcedureMeta(def.meta))
          .handler(async ({ input, ctx }) => {
            const fn = getVendorToolHandler(ctx.provider, namespace, method);
            if (!fn) {
              throw new Error(`Provider does not implement vendor tool '${procedurePath}'`);
            }
            return await fn(input);
          });
      }
    }
  }

  return t.router(procedures);
}

