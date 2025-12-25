#!/usr/bin/env node

/**
 * Utilities for automatically generating CLI commands from provider contracts
 */

import type { z } from 'zod';
import type { Argv, CommandModule } from 'yargs';

export interface ToolDefinition<TProvider = unknown, TInput = unknown, TOutput = unknown> {
  name: string;
  inputSchema: z.ZodObject<any>;
  handler: (provider: TProvider, input: TInput) => Promise<TOutput>;
  description?: string;
}

export interface CommonOptions {
  [key: string]: {
    type: 'string' | 'boolean' | 'number';
    describe: string;
    default?: string | boolean | number;
  };
}

export interface GenerateCommandsOptions<TProvider> {
  toolDefinitions: ToolDefinition<TProvider, any, any>[];
  commonOptions?: CommonOptions;
  getProvider: (providerName?: string) => TProvider | null;
}

export interface ToolContract<TToolName extends string> {
  toolNames: readonly TToolName[];
  inputSchemas: Record<TToolName, z.ZodObject<any>>;
  descriptions?: Record<TToolName, string>;
}

export interface GenerateCommandsFromContractOptions<TProvider, TToolName extends string> {
  contract: ToolContract<TToolName>;
  commonOptions?: CommonOptions;
  getProvider: (providerName?: string) => TProvider | null;
}

/**
 * Extract yargs options from a Zod schema
 */
export function extractYargsOptionsFromSchema(schema: z.ZodObject<any>): {
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
export function buildInputFromArgs(
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

/**
 * Generate tool definitions from contract automatically
 */
export function generateToolDefinitionsFromContract<TProvider, TToolName extends string>(
  contract: ToolContract<TToolName>
): ToolDefinition<TProvider, any, any>[] {
  return contract.toolNames.map((toolName) => {
    const inputSchema = contract.inputSchemas[toolName];
    if (!inputSchema) {
      throw new Error(`No input schema found for tool: ${toolName}`);
    }

    const description = contract.descriptions?.[toolName];

    return {
      name: toolName,
      inputSchema,
      handler: async (provider: TProvider, input: any) => {
        // Dynamically call the method on provider
        const method = (provider as unknown as Record<string, (input: any) => Promise<any>>)[toolName];
        if (typeof method !== 'function') {
          throw new Error(`Provider does not implement tool: ${toolName}`);
        }
        return await method(input);
      },
      description
    };
  });
}

/**
 * Generate yargs command modules from contract (convenience function)
 */
export function generateProviderCommandsFromContract<TProvider, TToolName extends string>(
  options: GenerateCommandsFromContractOptions<TProvider, TToolName>
): CommandModule[] {
  const toolDefinitions = generateToolDefinitionsFromContract(options.contract);
  return generateProviderCommands({
    toolDefinitions,
    commonOptions: options.commonOptions,
    getProvider: options.getProvider
  });
}

/**
 * Generate yargs command modules from tool definitions
 */
export function generateProviderCommands<TProvider>(
  options: GenerateCommandsOptions<TProvider>
): CommandModule[] {
  const { toolDefinitions, commonOptions = {}, getProvider } = options;

  return toolDefinitions.map((tool) => {
    const { positional, options: schemaOptions } = extractYargsOptionsFromSchema(tool.inputSchema);

    // Build command name and description
    const commandName = positional
      ? `${tool.name} <${positional.name}>`
      : tool.name;
    const description = tool.description || `Execute ${tool.name}`;

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
      const input = buildInputFromArgs(args, tool.inputSchema, positional?.name);

      // Validate input with schema
      const validatedInput = tool.inputSchema.parse(input);

      // Call handler
      const result = await tool.handler(provider, validatedInput);

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
  });
}

