import type { z } from 'zod';

export type ToolExample = {
  command: string;
  description?: string;
};

export interface ToolMeta {
  title?: string;
  description?: string;
  help?: string;
  examples?: ToolExample[];
  timeoutMs?: number;
  idempotent?: boolean;
  deprecated?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

export type ToolDef<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny
> = {
  input: TInput;
  output: TOutput;
  meta?: ToolMeta;
};

export type ToolsSpec = Record<string, ToolDef>;
export type VendorToolsSpec = Record<string, ToolsSpec>;

export function tool<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  def: ToolDef<TInput, TOutput>
): ToolDef<TInput, TOutput> {
  return def;
}

export function defineTools<const TTools extends ToolsSpec>(tools: TTools): TTools {
  return tools;
}

export function defineVendorTools<const TVendor extends VendorToolsSpec>(vendorTools: TVendor): TVendor {
  return vendorTools;
}

type ToolHandlerFromDef<T extends ToolDef> = (
  input: z.input<T['input']>
) => Promise<z.output<T['output']>>;

export type ProviderToolsFromSpec<TTools extends ToolsSpec> = {
  [K in keyof TTools]: ToolHandlerFromDef<TTools[K]>;
};

export type ProviderFromTools<TTools extends ToolsSpec, TVendor extends VendorToolsSpec | undefined = undefined> =
  {
    tools: ProviderToolsFromSpec<TTools>;
    vendor: TVendor extends VendorToolsSpec
      ? { [NS in keyof TVendor]: ProviderToolsFromSpec<TVendor[NS]> }
      : Record<string, never>;
  } & ProviderToolsFromSpec<TTools>;

