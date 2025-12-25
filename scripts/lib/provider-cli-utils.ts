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
  positionals: Array<{ name: string; describe: string; optional?: boolean }>;
  options: Record<string, { type: string; describe: string; default?: unknown }>;
} {
  const shape = schema.shape;
  const options: Record<string, { type: string; describe: string; default?: unknown }> = {};
  const positionals: Array<{ name: string; describe: string; optional?: boolean }> = [];

  // Collect all required and optional fields
  const requiredFields: Array<{ name: string; field: z.ZodTypeAny }> = [];
  const optionalFields: Array<{ name: string; field: z.ZodTypeAny }> = [];

  for (const [key, field] of Object.entries(shape)) {
    const zodField = field as z.ZodTypeAny;
    const def = zodField._def;

    // Check if field is optional or has default
    const isOptional = def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault';
    
    if (isOptional) {
      optionalFields.push({ name: key, field: zodField });
    } else {
      // Required field - will be positional
      requiredFields.push({ name: key, field: zodField });
    }
  }

  // Add all required fields as positionals (in order)
  for (const { name, field } of requiredFields) {
    const zodField = field as z.ZodTypeAny;
    const def = zodField._def;
    
    // Determine type for description
    let typeDesc = 'string';
    if (def.typeName === 'ZodString') {
      typeDesc = 'string';
    } else if (def.typeName === 'ZodNumber') {
      typeDesc = 'number';
    } else if (def.typeName === 'ZodBoolean') {
      typeDesc = 'boolean';
    }
    
    positionals.push({
      name,
      describe: `${name} (${typeDesc})`
    });
  }

  // If no required fields but exactly one optional field, make it optional positional
  let skipFirstOptional = false;
  if (positionals.length === 0 && optionalFields.length === 1) {
    const { name, field } = optionalFields[0];
    const zodField = field as z.ZodTypeAny;
    const def = zodField._def;
    
    // Get inner type
    let innerType = zodField;
    if (def.typeName === 'ZodOptional') {
      innerType = def.innerType;
    } else if (def.typeName === 'ZodDefault') {
      innerType = def.innerType;
    }
    
    const innerDef = (innerType as z.ZodTypeAny)._def;
    
    // Determine type for description
    let typeDesc = 'string';
    if (innerDef.typeName === 'ZodString') {
      typeDesc = 'string';
    } else if (innerDef.typeName === 'ZodNumber') {
      typeDesc = 'number';
    } else if (innerDef.typeName === 'ZodBoolean') {
      typeDesc = 'boolean';
    }
    
    positionals.push({
      name,
      describe: `${name} (${typeDesc})`,
      optional: true
    });
    // Mark to skip this field when processing options
    skipFirstOptional = true;
  }

  // Process optional fields as options
  for (let i = 0; i < optionalFields.length; i++) {
    // Skip the first optional field if it was made positional
    if (skipFirstOptional && i === 0) {
      continue;
    }
    const { name, field } = optionalFields[i];
    const zodField = field as z.ZodTypeAny;
    const def = zodField._def;

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

    // Check for default value
    let defaultValue: unknown = undefined;
    if (def.typeName === 'ZodDefault') {
      defaultValue = def.defaultValue();
    }

    options[name] = {
      type,
      describe: `${name} (${type})`,
      default: defaultValue
    };
  }

  return { positionals, options };
}

/**
 * Build input object from parsed args, handling positional arguments
 */
export function buildInputFromArgs(
  args: Record<string, unknown>,
  schema: z.ZodObject<any>,
  positionalNames?: string[]
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const shape = schema.shape;
  const handledKeys = new Set<string>();

  // Handle positional arguments
  if (positionalNames && positionalNames.length > 0) {
    for (let i = 0; i < positionalNames.length; i++) {
      const positionalName = positionalNames[i];
      if (args[positionalName] !== undefined && args[positionalName] !== null && args[positionalName] !== '') {
        const value = args[positionalName];
        // Use the value directly for the positional field
        input[positionalName] = value;
        handledKeys.add(positionalName);
      }
    }
  }

  // Copy other options (skip already handled positionals)
  for (const [key] of Object.entries(shape)) {
    if (handledKeys.has(key)) {
      continue;
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
    const { positionals, options: schemaOptions } = extractYargsOptionsFromSchema(tool.inputSchema);

    // Build command name and description
    let commandName = tool.name;
    if (positionals.length > 0) {
      const positionalNames = positionals.map(p => p.optional ? `[${p.name}]` : `<${p.name}>`).join(' ');
      commandName = `${tool.name} ${positionalNames}`;
    }
    const description = tool.description || `Execute ${tool.name}`;

    // Build yargs builder
    const builder = (yargs: Argv) => {
      let y = yargs;

      // Add positional arguments
      for (const positional of positionals) {
        y = y.positional(positional.name, {
          type: 'string',
          describe: positional.describe,
          demandOption: !positional.optional
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
      const positionalNames = positionals.map(p => p.name);
      const input = buildInputFromArgs(args, tool.inputSchema, positionalNames);

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

