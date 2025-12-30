#!/usr/bin/env node

/**
 * Unified API CLI - Access all module APIs through a single CLI interface
 *
 * Usage:
 *   api-cli <module>.<procedurePath> [options]
 *
 * Examples:
 *   api-cli ci.fetchPR --prId 123
 *   api-cli ci.fetchCheckStatus --branch main
 */

import { createYargs, installEpipeHandler } from './lib/cli.js';
import { findWorkspaceRoot } from './lib/workspace-root.js';
import { readEnvFile } from './lib/env.js';
import { getUnifiedAPIEntries } from './lib/api.js';
import { ensureProvidersDiscovered, createProviderGetter } from './lib/api-cli/provider-runtime.js';
import { formatAvailableMethods, resolveProcedureFromSpec } from './lib/api-cli/help-formatter.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function failUnsupportedProviderMethod(args: {
  providerName: string;
  moduleName: string;
  procedurePath: string;
  supported: string[];
}): never {
  const supportedList = args.supported.length > 0 ? `\nSupported methods:\n  - ${args.supported.join('\n  - ')}` : '';
  throw new Error(
    `Provider '${args.providerName}' does not support '${args.moduleName}.${args.procedurePath}'.${supportedList}`
  );
}

function assertProviderSupportsProcedure(args: {
  provider: any;
  moduleName: string;
  procedurePath: string;
}): void {
  const { provider, moduleName, procedurePath } = args;
  const providerName = String(provider?.name || provider?.manifest?.name || 'unknown');

  const tools = (provider?.manifest?.tools || []) as string[];
  const vendorTools = (provider?.manifest?.vendorTools || {}) as Record<string, string[] | undefined>;

  if (procedurePath.startsWith('vendor.')) {
    const parts = procedurePath.split('.');
    const ns = parts[1] || '';
    const method = parts.slice(2).join('.');
    const supported = (vendorTools[ns] || []).slice().sort();
    if (!supported.includes(method)) {
      failUnsupportedProviderMethod({
        providerName,
        moduleName,
        procedurePath,
        supported: supported.map((m) => `${moduleName}.vendor.${ns}.${m}`)
      });
    }
    return;
  }

  const supported = tools.slice().sort().map((t) => `${moduleName}.${t}`);
  if (!tools.includes(procedurePath)) {
    failUnsupportedProviderMethod({
      providerName,
      moduleName,
      procedurePath,
      supported
    });
  }
}

/**
 * Parse dot-notation command (e.g., "ci.fetchPR", "ci.vendor.github.fetchX")
 */
function parseCommand(command: string): { moduleName: string; procedurePath: string } | null {
  const parts = command.split('.');
  if (parts.length < 2) return null;
  const moduleName = String(parts[0] || '').trim();
  const procedurePath = parts.slice(1).join('.').trim();
  if (!moduleName || !procedurePath) return null;
  return { moduleName, procedurePath };
}

/**
 * Generate example command for a procedure
 */
async function generateExample(moduleName: string, procedurePath: string, procedure: any): Promise<string> {
  try {
    const { extractYargsOptionsFromSchema } = await import('./lib/provider-cli-utils.js');
    
    const inputSchema = procedure.input;
    if (!inputSchema || typeof inputSchema !== 'object') {
      return `  api-cli ${moduleName}.${procedurePath}`;
    }
    
    const { positionals, options } = extractYargsOptionsFromSchema(inputSchema);
    
    // Build example with positional arguments if present
    let example = `  api-cli ${moduleName}.${procedurePath}`;
    
    for (const positional of positionals) {
      // Use a sample value based on the positional name
      const sampleValue = positional.name.includes('branch') || positional.name.includes('Branch') ? 'feature/new-feature' :
                         positional.name.includes('pr') || positional.name.includes('Pr') ? 'feature/new-feature' :
                         positional.name.includes('id') || positional.name.includes('Id') ? '123' :
                         positional.name.includes('tool') || positional.name.includes('Tool') ? 'generate_answer' :
                         positional.name.includes('server') || positional.name.includes('Server') ? 'server-name' :
                         'value';
      example += ` ${sampleValue}`;
    }
    
    // Add a few key options as examples (skip common ones like owner/repo that are usually optional)
    const skipKeys = ['owner', 'repo', 'provider'];
    const optionKeys = Object.keys(options)
      .filter(key => !skipKeys.includes(key))
      .slice(0, 1); // Only add one optional parameter as example
    
    for (const key of optionKeys) {
      const opt = options[key];
      if (opt.type === 'string' && !opt.default) {
        const sampleValue = key.includes('branch') ? 'main' :
                           key.includes('pr') ? '123' :
                           key.includes('id') ? '123' :
                           key.includes('check') ? 'check-123' :
                           'value';
        example += ` --${key} ${sampleValue}`;
      }
    }
    
    return example;
  } catch {
    // Fallback to simple example
    return `  api-cli ${moduleName}.${procedurePath}`;
  }
}

async function main(argv = process.argv): Promise<void> {
  installEpipeHandler();

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  
  // Load environment variables from .env file
  if (workspaceRoot) {
    const envPath = path.join(workspaceRoot, '.env');
    const env = readEnvFile(envPath);
    // Set environment variables from .env (don't override existing ones)
    for (const [key, value] of Object.entries(env)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // Get unified API entries (quiet mode to suppress warnings and side effects)
  const registry = await getUnifiedAPIEntries({ quiet: true });

  // Parse command from arguments
  const args = argv.slice(2);
  
  // Check if help was requested or no arguments provided
  const isHelpRequested = args.length === 0 || args[0] === '--help' || args[0] === '-h';
  
  if (isHelpRequested) {
    console.log('Usage: api-cli <module>.<procedurePath> [options]');
    console.log('\nAvailable API methods:');
    console.log(formatAvailableMethods(registry));
    console.log('For detailed help on a specific method, use:');
    console.log('  api-cli <module>.<procedurePath> --help');
    
    if (args.length === 0) {
      process.exitCode = 0;
    }
    return;
  }

  const command = args[0];
  const parsed = parseCommand(command);

  if (!parsed) {
    console.error(`Error: Invalid command format. Expected "module.procedurePath", got "${command}"`);
    console.error('Example: api-cli ci.fetchPR --prId 123');
    process.exitCode = 1;
    return;
  }

  const { moduleName, procedurePath } = parsed;

  // Find router for module
  const entry = registry[moduleName];
  if (!entry) {
    console.error(`Error: Module "${moduleName}" not found in unified API`);
    console.error('\nAvailable extensions:');
    for (const name of Object.keys(registry)) {
      console.error(`  - ${name}`);
    }
    process.exitCode = 1;
    return;
  }

  const router = entry.router;

  // Resolve procedure from spec (preferred) or from router internals (legacy fallback)
  const resolvedFromSpec = entry.spec ? resolveProcedureFromSpec(entry.spec, procedurePath) : null;
  const legacyProcedures = resolvedFromSpec ? null : ((router as any).procedures as Record<string, any> | undefined);
  const legacyProcedure = legacyProcedures ? legacyProcedures[procedurePath] : undefined;

  if (!resolvedFromSpec && !legacyProcedure) {
    console.error(`Error: Procedure "${procedurePath}" not found in module "${moduleName}"`);
    console.error(`\nTry: api-cli --help`);
    process.exitCode = 1;
    return;
  }

  const procedureMeta = resolvedFromSpec?.meta || legacyProcedure?.meta;
  const procedureInput = (resolvedFromSpec?.input || legacyProcedure?.input) as any;
  const procedureExamples = resolvedFromSpec?.examples;

  // Initialize providers for the module (spec-first, with legacy fallback for modules without spec)
  let requiresProvider = entry.requiresProvider;
  const providerType = entry.providerType || moduleName;
  let getModuleProvider: ((providerName?: string) => unknown | null) | null = null;

  if (requiresProvider || !entry.spec) {
    await ensureProvidersDiscovered(workspaceRoot, __dirname);
    const { getProvider, providers } = createProviderGetter({ moduleName, workspaceRoot, providerType });
    getModuleProvider = getProvider;
    if (!entry.spec) {
      requiresProvider = providers.length > 0;
    }
  }

  // Create command module manually (similar to router.toCli but for single procedure)
  const { extractYargsOptionsFromSchema, buildInputFromArgs } = await import('./lib/provider-cli-utils.js');
  const { positionals, options: schemaOptions } = extractYargsOptionsFromSchema(procedureInput);

  // Build command name from positionals
  let commandName = procedurePath;
  if (positionals.length > 0) {
    const positionalNames = positionals.map(p => p.optional ? `[${p.name}]` : `<${p.name}>`).join(' ');
    commandName = `${procedurePath} ${positionalNames}`;
  }
  const description = procedureMeta?.title || procedureMeta?.description || `Execute ${procedurePath}`;

  // Build yargs builder
  const builder = (yargs: any) => {
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
    if (requiresProvider) {
      y = y.option('provider', {
        type: 'string',
        describe: 'Provider name (overrides config/env)',
        default: ''
      });
    }

    return y;
  };

  // Build handler
  const handler = async (args: Record<string, unknown>) => {
    // Get provider (if module requires one)
    const providerName = (args.provider as string | undefined) || undefined;
    const provider = requiresProvider && getModuleProvider ? getModuleProvider(providerName) : null;
    
    // Only require provider if module requires one
    if (requiresProvider && !provider) {
      throw new Error(`Provider not found${providerName ? `: ${providerName}` : ''}`);
    }
    if (requiresProvider && provider) {
      assertProviderSupportsProcedure({ provider, moduleName, procedurePath });
    }

    // Build input from args
    const positionalNames = positionals.map(p => p.name);
    const input = buildInputFromArgs(args, procedureInput, positionalNames);

    // Call procedure through router
    const result = await router.call(procedurePath as any, input, { provider });

    // Output JSON
    const output: Record<string, unknown> = {
      result
    };
    
    // Only include provider info if module requires one
    if (requiresProvider && provider) {
      output.provider = (provider as { name?: string })?.name || 'unknown';
    }

    process.stdout.write(JSON.stringify(output, null, 2));
    if (!process.stdout.isTTY) {
      process.stdout.write('\n');
    }
  };

  // Build yargs with command
  // Remove the command from args since we're creating it as a yargs command
  const remainingArgs = args.slice(1); // Skip the 'ci.fetchPR' part
  
  const yargsInstance = createYargs(['node', 'api-cli', procedurePath, ...remainingArgs])
    .scriptName('api-cli')
    .strict()
    .usage(`Usage: $0 ${command} [options]`)
    .command({
      command: commandName,
      describe: description,
      builder,
      handler
    });

  // Add epilogue: tool-specific help/examples + general methods list
  const epilogueParts: string[] = [];
  if (procedureMeta?.help) {
    epilogueParts.push(String(procedureMeta.help).trim());
  }
  if (procedureExamples && procedureExamples.length > 0) {
    epilogueParts.push(
      'Examples:\n' + procedureExamples.map((e) => `  ${e.command}${e.description ? `  # ${e.description}` : ''}`).join('\n')
    );
  } else if (resolvedFromSpec) {
    // Fallback to heuristic example generation if spec didn't provide examples
    const ex = await generateExample(moduleName, procedurePath, { input: procedureInput });
    epilogueParts.push(`Example:\n  ${ex.trim()}`);
  }
  epilogueParts.push('Available API methods:\n' + formatAvailableMethods(registry));
  yargsInstance.epilogue('\n' + epilogueParts.filter(Boolean).join('\n\n'));

  // Parse and execute
  await yargsInstance
    .help()
    .parseAsync();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    const err = e as { message?: string; stack?: string };
    // eslint-disable-next-line no-console
    console.error(err && err.stack ? err.stack : err.message || String(e));
    process.exitCode = 1;
  });
}

export { main };
