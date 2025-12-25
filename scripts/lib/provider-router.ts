#!/usr/bin/env node

/**
 * Generic router infrastructure for provider contracts (tRPC-like pattern)
 */

import type { z } from 'zod';
import type { Argv, CommandModule } from 'yargs';
import { ZodError } from 'zod';

/**
 * Procedure metadata
 */
export interface ProcedureMeta {
  title?: string;
  description?: string;
  idempotent?: boolean;
  timeoutMs?: number;
  [key: string]: unknown;
}

/**
 * Procedure handler context
 */
export interface ProcedureContext<TProvider = unknown> {
  provider: TProvider;
  [key: string]: unknown;
}

/**
 * Procedure handler function
 */
export type ProcedureHandler<TInput = unknown, TOutput = unknown, TProvider = unknown> = (args: {
  input: TInput;
  ctx: ProcedureContext<TProvider>;
}) => Promise<TOutput>;

/**
 * Procedure definition
 */
export interface Procedure<TInput = unknown, TOutput = unknown, TProvider = unknown> {
  input: z.ZodType<TInput>;
  output: z.ZodType<TOutput>;
  meta: ProcedureMeta;
  handler: ProcedureHandler<TInput, TOutput, TProvider>;
}

/**
 * Router error with typed error code
 */
export class RouterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'RouterError';
  }
}

/**
 * Procedure builder for fluent API
 */
export class ProcedureBuilder<TInput = unknown, TOutput = unknown, TProvider = unknown> {
  private _input?: z.ZodType<TInput>;
  private _output?: z.ZodType<TOutput>;
  private _meta: ProcedureMeta = {};
  private _handler?: ProcedureHandler<TInput, TOutput, TProvider>;

  input<TNewInput>(schema: z.ZodType<TNewInput>): ProcedureBuilder<TNewInput, TOutput, TProvider> {
    this._input = schema as z.ZodType<unknown>;
    return this as unknown as ProcedureBuilder<TNewInput, TOutput, TProvider>;
  }

  output<TNewOutput>(schema: z.ZodType<TNewOutput>): ProcedureBuilder<TInput, TNewOutput, TProvider> {
    this._output = schema as z.ZodType<unknown>;
    return this as unknown as ProcedureBuilder<TInput, TNewOutput, TProvider>;
  }

  meta(meta: ProcedureMeta): this {
    this._meta = { ...this._meta, ...meta };
    return this;
  }

  handler(handler: ProcedureHandler<TInput, TOutput, TProvider>): Procedure<TInput, TOutput, TProvider> {
    if (!this._input) {
      throw new Error('Procedure must have input schema');
    }
    if (!this._output) {
      throw new Error('Procedure must have output schema');
    }
    if (!handler) {
      throw new Error('Procedure must have handler');
    }

    return {
      input: this._input,
      output: this._output,
      meta: this._meta,
      handler
    };
  }
}

/**
 * Router builder
 */
export interface RouterBuilder<TProvider = unknown> {
  procedure: ProcedureBuilder<unknown, unknown, TProvider>;
  router: <TProcedures extends Record<string, Procedure<any, any, TProvider>>>(
    procedures: TProcedures
  ) => ProviderRouter<TProcedures, TProvider>;
}

/**
 * Provider router
 */
export class ProviderRouter<TProcedures extends Record<string, Procedure<any, any, TProvider>>, TProvider = unknown> {
  constructor(private readonly procedures: TProcedures) {}

  /**
   * Call a procedure by name with raw input
   */
  async call<TProcedureName extends keyof TProcedures>(
    procedureName: TProcedureName,
    rawInput: unknown,
    context: ProcedureContext<TProvider>
  ): Promise<z.infer<TProcedures[TProcedureName]['output']>> {
    const procedure = this.procedures[procedureName];
    if (!procedure) {
      throw new RouterError('PROCEDURE_NOT_FOUND', `Procedure '${String(procedureName)}' not found`);
    }

    try {
      // Parse input
      const input = procedure.input.parse(rawInput);

      // Call handler
      const result = await procedure.handler({ input, ctx: context });

      // Parse output
      const output = procedure.output.parse(result);

      return output;
    } catch (error) {
      if (error instanceof ZodError) {
        if (error.issues.some((issue) => issue.path.length === 0 && issue.code === 'invalid_type')) {
          // Input validation error
          throw new RouterError(
            'INVALID_INPUT',
            `Input validation failed for procedure '${String(procedureName)}'`,
            error
          );
        } else {
          // Output validation error
          throw new RouterError(
            'INVALID_OUTPUT',
            `Output validation failed for procedure '${String(procedureName)}'`,
            error
          );
        }
      }
      if (error instanceof RouterError) {
        throw error;
      }
      // Provider error
      throw new RouterError(
        'PROVIDER_ERROR',
        `Provider error in procedure '${String(procedureName)}': ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  /**
   * Generate yargs CLI commands from router
   */
  toCli(
    yargs: Argv,
    options: {
      getProvider: (providerName?: string) => TProvider | null;
      commonOptions?: Record<
        string,
        {
          type: 'string' | 'boolean' | 'number';
          describe: string;
          default?: string | boolean | number;
        }
      >;
    }
  ): Argv {
    const { getProvider, commonOptions = {} } = options;

    for (const [procedureName, procedure] of Object.entries(this.procedures)) {
      const command = this.createCommand(procedureName, procedure, getProvider, commonOptions);
      yargs = yargs.command(command);
    }

    return yargs;
  }

  /**
   * Create a yargs command module from a procedure
   */
  private createCommand(
    procedureName: string,
    procedure: Procedure<any, any, TProvider>,
    getProvider: (providerName?: string) => TProvider | null,
    commonOptions: Record<
      string,
      {
        type: 'string' | 'boolean' | 'number';
        describe: string;
        default?: string | boolean | number;
      }
    >
  ): CommandModule {
    const { positional, options: schemaOptions } = this.extractYargsOptionsFromSchema(procedure.input as z.ZodObject<any>);

    // Build command name and description
    const commandName = positional ? `${procedureName} <${positional.name}>` : procedureName;
    const description = procedure.meta.title || procedure.meta.description || `Execute ${procedureName}`;

    // Build yargs builder
    const builder = (yargs: Argv) => {
      let y = yargs;

      // Add positional argument if needed
      if (positional) {
        y = y.positional(positional.name, {
          type: 'string',
          describe: positional.describe
        });
      }

      // Add schema options
      for (const [key, opt] of Object.entries(schemaOptions)) {
        y = y.option(key, {
          type: opt.type as 'string' | 'boolean' | 'number',
          describe: opt.describe,
          default: opt.default
        });
      }

      // Add common options
      for (const [key, opt] of Object.entries(commonOptions)) {
        y = y.option(key, {
          type: opt.type,
          describe: opt.describe,
          default: opt.default
        });
      }

      return y;
    };

    // Build handler
    const handler = async (args: Record<string, unknown>) => {
      // Get provider
      const providerName = args.provider as string | undefined;
      const provider = getProvider(providerName);

      if (!provider) {
        throw new Error(`Provider not found${providerName ? `: ${providerName}` : ''}`);
      }

      // Build input from args
      const input = this.buildInputFromArgs(args, procedure.input as z.ZodObject<any>, positional?.name);

      // Call procedure through router
      const result = await this.call(procedureName as keyof TProcedures, input, { provider });

      // Output JSON
      const output = {
        provider: (provider as { name?: string }).name || 'unknown',
        result
      };

      process.stdout.write(JSON.stringify(output, null, 2));
      if (!process.stdout.isTTY) {
        process.stdout.write('\n');
      }
    };

    return {
      command: commandName,
      describe: description,
      builder,
      handler
    };
  }

  /**
   * Extract yargs options from a Zod schema
   */
  private extractYargsOptionsFromSchema(schema: z.ZodObject<any>): {
    positional?: { name: string; describe: string };
    options: Record<string, { type: string; describe: string; default?: unknown }>;
  } {
    const shape = schema.shape;
    const options: Record<string, { type: string; describe: string; default?: unknown }> = {};
    let positional: { name: string; describe: string } | undefined;

    // Check if schema has prId and branch fields (positional argument pattern)
    const hasPrId = 'prId' in shape;
    const hasBranch = 'branch' in shape;
    if (hasPrId && hasBranch) {
      positional = {
        name: 'prIdOrBranch',
        describe: 'PR ID (number) or branch name'
      };
    }

    // Check if schema has issueId as a required field (positional argument pattern)
    const hasIssueId = 'issueId' in shape;
    if (hasIssueId && !positional) {
      const issueIdField = shape.issueId as z.ZodTypeAny;
      const issueIdDef = issueIdField._def;
      const isIssueIdOptional = issueIdDef.typeName === 'ZodOptional' || issueIdDef.typeName === 'ZodDefault';
      if (!isIssueIdOptional) {
        // issueId is required and no other positional pattern exists
        positional = {
          name: 'issueId',
          describe: 'Issue ID or key'
        };
      }
    }

    for (const [key, field] of Object.entries(shape)) {
      // Skip prId and branch if they're used as positional
      if ((key === 'prId' || key === 'branch') && positional) {
        continue;
      }

      const zodField = field as z.ZodTypeAny;
      const def = zodField._def;

      // Check if field is optional or has default
      const isOptional = def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault';
      if (!isOptional) {
        continue; // Skip required fields that aren't positional
      }

      // Get inner type
      let innerType = zodField;
      if (def.typeName === 'ZodOptional') {
        innerType = def.innerType;
      } else if (def.typeName === 'ZodDefault') {
        innerType = def.innerType;
      }

      const innerDef = (innerType as z.ZodTypeAny)._def;

      // Determine type
      let type = 'string';
      if (innerDef.typeName === 'ZodString') {
        type = 'string';
      } else if (innerDef.typeName === 'ZodNumber') {
        type = 'number';
      } else if (innerDef.typeName === 'ZodBoolean') {
        type = 'boolean';
      } else if (innerDef.typeName === 'ZodUnion') {
        // For union types, default to string
        type = 'string';
      }

      options[key] = {
        type,
        describe: `${key} (${type})`
      };
    }

    return { positional, options };
  }

  /**
   * Build input object from parsed args, handling positional arguments
   */
  private buildInputFromArgs(
    args: Record<string, unknown>,
    schema: z.ZodObject<any>,
    positionalName?: string
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    const shape = schema.shape;

    // Handle positional argument (prId|branch pattern or issueId)
    if (positionalName && args[positionalName]) {
      const value = String(args[positionalName]);
      if (positionalName === 'prIdOrBranch') {
        // Check if it's a number (PR ID) or string (branch name)
        if (value.match(/^\d+$/)) {
          input.prId = Number.parseInt(value, 10);
        } else {
          input.branch = value;
        }
      } else if (positionalName === 'issueId') {
        // Handle issueId as positional
        input.issueId = value;
      }
    }

    // Copy other options
    for (const [key] of Object.entries(shape)) {
      if (key === 'prId' || key === 'branch' || key === 'issueId') {
        // Already handled by positional argument if applicable
        if (positionalName === 'issueId' && key === 'issueId') {
          continue;
        }
        if (positionalName === 'prIdOrBranch' && (key === 'prId' || key === 'branch')) {
          continue;
        }
      }
      if (args[key] !== undefined && args[key] !== null && args[key] !== '') {
        input[key] = args[key];
      }
    }

    return input;
  }
}

/**
 * Initialize provider contract (factory function)
 */
export function initProviderContract<TProvider = unknown>(): RouterBuilder<TProvider> {
  return {
    procedure: new ProcedureBuilder<unknown, unknown, TProvider>(),
    router: <TProcedures extends Record<string, Procedure<any, any, TProvider>>>(
      procedures: TProcedures
    ) => {
      return new ProviderRouter<TProcedures, TProvider>(procedures);
    }
  };
}

