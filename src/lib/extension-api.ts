import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface ProcedureMeta {
  title?: string;
  description?: string;
  idempotent?: boolean;
  timeoutMs?: number;
}

export type ProcedureHandler<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;

export interface ProcedureDefinition<TInput = unknown, TOutput = unknown> {
  _meta: ProcedureMeta;
  _input?: z.ZodType<TInput>;
  _output?: z.ZodType<TOutput>;
  _handler?: ProcedureHandler<TInput, TOutput>;
  _type: 'query' | 'mutation' | 'contract';
}

class ProcedureBuilder<TInput = unknown, TOutput = unknown> {
  private _meta: ProcedureMeta = {};
  private _input?: z.ZodType<TInput>;
  private _output?: z.ZodType<TOutput>;

  title(title: string): this {
    this._meta.title = title;
    return this;
  }

  description(description: string): this {
    this._meta.description = description;
    return this;
  }

  meta(meta: Partial<ProcedureMeta>): this {
    this._meta = { ...this._meta, ...meta };
    return this;
  }

  input<TNewInput>(schema: z.ZodType<TNewInput>): ProcedureBuilder<TNewInput, TOutput> {
    const builder = new ProcedureBuilder<TNewInput, TOutput>();
    builder._meta = { ...this._meta };
    builder._input = schema;
    builder._output = this._output as z.ZodType<TOutput> | undefined;
    return builder;
  }

  return<TNewOutput>(schema: z.ZodType<TNewOutput>): ProcedureBuilder<TInput, TNewOutput> {
    const builder = new ProcedureBuilder<TInput, TNewOutput>();
    builder._meta = { ...this._meta };
    builder._input = this._input as z.ZodType<TInput> | undefined;
    builder._output = schema;
    return builder;
  }

  query(handler: ProcedureHandler<TInput, TOutput>): ProcedureDefinition<TInput, TOutput> {
    return {
      _meta: this._meta,
      _input: this._input,
      _output: this._output,
      _handler: handler,
      _type: 'query'
    };
  }

  mutation(handler: ProcedureHandler<TInput, TOutput>): ProcedureDefinition<TInput, TOutput> {
    return {
      _meta: this._meta,
      _input: this._input,
      _output: this._output,
      _handler: handler,
      _type: 'mutation'
    };
  }

  /**
   * Create a contract definition (no handler, just schema)
   * Used for defining provider contracts
   */
  contract(): ProcedureDefinition<TInput, TOutput> {
    return {
      _meta: this._meta,
      _input: this._input,
      _output: this._output,
      _type: 'contract'
    };
  }
}

export const publicProcedure = new ProcedureBuilder();

export type ApiDefinition = Record<string, ProcedureDefinition<any, any>>;
export type ContractDefinition = Record<string, Record<string, ProcedureDefinition<any, any>>>;

export interface ExtensionDefinition {
  api: ApiDefinition;
  contracts?: ContractDefinition;
}

export interface ExtensionContext {
  [key: string]: unknown;
}

export interface WorkspaceContext {
  root: string;
  config: Record<string, unknown>;
}

export type ExtensionFactory = (
  ext: ExtensionContext,
  workspace: WorkspaceContext
) => ExtensionDefinition;

export function defineExtension(factory: ExtensionFactory): ExtensionFactory {
  return factory;
}

// Type helpers for extracting input/output types from procedures
export type InferProcedureInput<T> = T extends ProcedureDefinition<infer TInput, any> ? TInput : never;
export type InferProcedureOutput<T> = T extends ProcedureDefinition<any, infer TOutput> ? TOutput : never;

// Type helper for creating provider implementations from contracts
export type ProviderFromContract<T extends Record<string, ProcedureDefinition<any, any>>> = {
  [K in keyof T]: (input: InferProcedureInput<T[K]>) => Promise<InferProcedureOutput<T[K]>>;
};

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\./g, '-')
    .toLowerCase();
}

function zodSchemaToYargsOptions(schema: z.ZodType<any> | undefined): Record<string, any> {
  if (!schema) return {};

  const jsonSchema = zodToJsonSchema(schema, { target: 'jsonSchema7' }) as any;
  const options: Record<string, any> = {};

  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const required = new Set(jsonSchema.required || []);

    for (const [key, prop] of Object.entries(jsonSchema.properties) as [string, any][]) {
      const opt: any = {
        describe: prop.description || prop.title || key,
        demandOption: required.has(key)
      };

      if (prop.type === 'string') {
        opt.type = 'string';
        if (prop.default !== undefined) opt.default = prop.default;
      } else if (prop.type === 'number' || prop.type === 'integer') {
        opt.type = 'number';
        if (prop.default !== undefined) opt.default = prop.default;
      } else if (prop.type === 'boolean') {
        opt.type = 'boolean';
        if (prop.default !== undefined) opt.default = prop.default;
      } else if (prop.type === 'array') {
        opt.type = 'array';
        if (prop.default !== undefined) opt.default = prop.default;
      } else {
        opt.type = 'string';
      }

      options[key] = opt;
    }
  }

  return options;
}

export interface ExtensionRouterOptions<TProvider> {
  getProvider: (providerName?: string) => TProvider | null;
  commonOptions?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YargsInstance = any;

export class ExtensionRouter<TProvider = unknown> {
  constructor(
    private readonly api: ApiDefinition,
    private readonly name: string
  ) {}

  toCli(yargs: YargsInstance, options: ExtensionRouterOptions<TProvider>): YargsInstance {
    const { getProvider, commonOptions = {} } = options;

    for (const [procedureName, procedure] of Object.entries(this.api)) {
      const commandName = toKebabCase(procedureName);
      const description = procedure._meta.description || procedure._meta.title || procedureName;
      const inputOptions = zodSchemaToYargsOptions(procedure._input);

      yargs = yargs.command(
        commandName,
        description,
        (y: YargsInstance) => {
          for (const [optName, optConfig] of Object.entries({ ...commonOptions, ...inputOptions })) {
            y = y.option(optName, optConfig);
          }
          return y;
        },
        async (argv: Record<string, unknown>) => {
          const provider = getProvider(argv.provider as string | undefined);
          if (!provider) {
            throw new Error(`No provider available for ${this.name}`);
          }

          // Build input from argv
          const input: Record<string, unknown> = {};
          for (const key of Object.keys(inputOptions)) {
            if (argv[key] !== undefined) {
              input[key] = argv[key];
            }
          }

          // Validate input
          if (procedure._input) {
            const parsed = procedure._input.safeParse(input);
            if (!parsed.success) {
              throw new Error(`Invalid input: ${parsed.error.message}`);
            }
          }

          // Execute handler
          if (!procedure._handler) {
            throw new Error(`No handler for procedure ${procedureName}`);
          }

          const result = await procedure._handler(input);

          // Output result
          if (result !== undefined && result !== null) {
            if (typeof result === 'object') {
              // eslint-disable-next-line no-console
              console.log(JSON.stringify(result, null, 2));
            } else {
              // eslint-disable-next-line no-console
              console.log(result);
            }
          }
        }
      );
    }

    return yargs;
  }
}

export function createExtensionRouter<TProvider>(
  extensionFactory: ExtensionFactory,
  name: string,
  context: { provider: TProvider }
): ExtensionRouter<TProvider> {
  const ext: ExtensionContext = { provider: context.provider };
  const workspace: WorkspaceContext = { root: process.cwd(), config: {} };
  const definition = extensionFactory(ext, workspace);
  return new ExtensionRouter<TProvider>(definition.api, name);
}
