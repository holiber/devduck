import type { z } from 'zod';

import type { Procedure, ProcedureContext, ProcedureMeta } from './provider-router.js';
import { ProviderRouter } from './provider-router.js';

export type ExtensionWorkspace = Record<string, unknown>;

export type ExtensionFactoryResult = {
  api?: Record<string, Procedure<any, any, any>>;
  /**
   * Provider contracts (schemas + metadata, no implementation).
   *
   * Shape is extension-defined, but the recommended convention is:
   *   contracts: { [providerType]: { [methodName]: publicProcedure... } }
   */
  contracts?: Record<string, unknown>;
};

export type ExtensionFactory<TExt = unknown, TWorkspace extends ExtensionWorkspace = ExtensionWorkspace> = (
  ext: TExt,
  workspace: TWorkspace
) => ExtensionFactoryResult;

type ExtensionRuntime = { ext: unknown; workspace: ExtensionWorkspace } | null;
let CURRENT_EXTENSION_RUNTIME: ExtensionRuntime = null;

function withExtensionRuntime<T>(runtime: NonNullable<ExtensionRuntime>, fn: () => T): T {
  const prev = CURRENT_EXTENSION_RUNTIME;
  CURRENT_EXTENSION_RUNTIME = runtime;
  try {
    return fn();
  } finally {
    CURRENT_EXTENSION_RUNTIME = prev;
  }
}

/**
 * Define an extension using the new tRPS-style API/contracts DSL.
 *
 * NOTE: This intentionally returns the factory function unchanged.
 * The runtime decides *when* and *with what context* to execute it.
 */
export function defineExtention<TExt = unknown, TWorkspace extends ExtensionWorkspace = ExtensionWorkspace>(
  factory: ExtensionFactory<TExt, TWorkspace>
): ExtensionFactory<TExt, TWorkspace> {
  return ((ext: TExt, workspace: TWorkspace) => {
    return withExtensionRuntime({ ext, workspace }, () => factory(ext, workspace));
  }) as ExtensionFactory<TExt, TWorkspace>;
}

type ResolverArgs<TExt, TWorkspace, TProvider> = {
  ctx: ProcedureContext<TProvider>;
  ext: TExt;
  workspace: TWorkspace;
};

type ProcedureResolver<TInput, TOutput, TExt, TWorkspace, TProvider> = (
  input: TInput,
  args: ResolverArgs<TExt, TWorkspace, TProvider>
) => Promise<TOutput> | TOutput;

class PublicProcedureBuilder<
  TInput = unknown,
  TOutput = unknown,
  TExt = unknown,
  TWorkspace extends ExtensionWorkspace = ExtensionWorkspace,
  TProvider = unknown
> {
  constructor(
    private readonly state: {
      input?: z.ZodType<TInput>;
      output?: z.ZodType<TOutput>;
      meta: ProcedureMeta;
    } = { meta: {} }
  ) {}

  title(title: string): PublicProcedureBuilder<TInput, TOutput, TExt, TWorkspace, TProvider> {
    return new PublicProcedureBuilder({
      ...this.state,
      meta: { ...this.state.meta, title }
    });
  }

  input<TNewInput>(
    schema: z.ZodType<TNewInput>
  ): PublicProcedureBuilder<TNewInput, TOutput, TExt, TWorkspace, TProvider> {
    return new PublicProcedureBuilder({
      input: schema as unknown as z.ZodType<any>,
      output: this.state.output as unknown as z.ZodType<any> | undefined,
      meta: this.state.meta
    }) as unknown as PublicProcedureBuilder<TNewInput, TOutput, TExt, TWorkspace, TProvider>;
  }

  return<TNewOutput>(
    schema: z.ZodType<TNewOutput>
  ): PublicProcedureBuilder<TInput, TNewOutput, TExt, TWorkspace, TProvider> {
    return new PublicProcedureBuilder({
      input: this.state.input as unknown as z.ZodType<any> | undefined,
      output: schema as unknown as z.ZodType<any>,
      meta: this.state.meta
    }) as unknown as PublicProcedureBuilder<TInput, TNewOutput, TExt, TWorkspace, TProvider>;
  }

  private buildProcedure(
    resolver: ProcedureResolver<TInput, TOutput, TExt, TWorkspace, TProvider>
  ): Procedure<TInput, TOutput, TProvider> {
    if (!this.state.input) throw new Error('publicProcedure: input(...) is required');
    if (!this.state.output) throw new Error('publicProcedure: return(...) is required');

    const runtime = CURRENT_EXTENSION_RUNTIME as { ext: TExt; workspace: TWorkspace } | null;
    if (!runtime) {
      throw new Error('publicProcedure: used outside of defineExtention(...) factory execution');
    }

    return {
      input: this.state.input,
      output: this.state.output,
      meta: this.state.meta,
      handler: async ({ input, ctx }) => {
        return await resolver(input, { ctx, ext: runtime.ext, workspace: runtime.workspace });
      }
    };
  }

  query(resolver: ProcedureResolver<TInput, TOutput, TExt, TWorkspace, TProvider>) {
    return this.buildProcedure(resolver);
  }

  mutation(resolver: ProcedureResolver<TInput, TOutput, TExt, TWorkspace, TProvider>) {
    return this.buildProcedure(resolver);
  }
}

export const publicProcedure = new PublicProcedureBuilder();

/**
 * Build a `ProviderRouter` from an extension factory.
 *
 * The router procedure schemas/meta are derived from a single "shape" evaluation
 * of the factory. The actual procedure implementation is executed by re-running
 * the factory *per invocation* using the current provider from `ctx.provider`.
 *
 * This enables the new DSL (`ext.<type>.*`) to work with existing CLI/router flows.
 */
export function createRouterFromExtensionFactory<TWorkspace extends ExtensionWorkspace>(args: {
  moduleName: string;
  factory: ExtensionFactory<any, TWorkspace>;
  workspace: TWorkspace;
}): ProviderRouter<Record<string, Procedure<any, any, any>>, any> {
  const { moduleName, factory, workspace } = args;

  // Evaluate once to discover procedure schemas/metadata.
  const shape = factory({}, workspace);
  const api = shape.api || {};

  const procedures: Record<string, Procedure<any, any, any>> = {};
  for (const [name, proc] of Object.entries(api)) {
    if (!proc || typeof proc !== 'object' || !('input' in proc) || !('output' in proc) || !('meta' in proc)) {
      throw new Error(`Extension '${moduleName}': api.${name} is not a valid procedure`);
    }

    procedures[name] = {
      input: (proc as any).input,
      output: (proc as any).output,
      meta: (proc as any).meta,
      handler: async ({ input, ctx }) => {
        const runtime = factory({ [moduleName]: ctx.provider }, workspace);
        const runtimeApi = runtime.api || {};
        const runtimeProc = runtimeApi[name];
        if (!runtimeProc) {
          throw new Error(`Extension '${moduleName}': missing runtime procedure '${name}'`);
        }
        return await runtimeProc.handler({ input, ctx });
      }
    };
  }

  return new ProviderRouter(procedures);
}

