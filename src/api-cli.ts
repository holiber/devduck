#!/usr/bin/env node

/**
 * Unified API CLI - Access all module APIs through a single CLI interface
 * 
 * Usage:
 *   api-cli <module>.<procedure> [options]
 * 
 * Examples:
 *   api-cli ci.fetchPR --prId 123
 *   api-cli ci.fetchCheckStatus --branch main
 */

import { createYargs, installEpipeHandler } from './lib/cli.js';
import { findWorkspaceRoot } from './lib/workspace-root.js';
import { readEnvFile } from './lib/env.js';
import { getUnifiedAPI } from './lib/api.js';
import {
  discoverProvidersFromModules,
  getProvidersByType,
  getProvider
} from './lib/provider-registry.js';
import { resolveBarducksRoot } from './lib/barducks-paths.js';
import { readJSON } from './lib/config.js';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from './lib/workspace-config.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type WorkspaceConfigLike = {
  extensionSettings?: Record<string, unknown>;
  repos?: string[];
};

/**
 * Pick provider name from config or environment
 */
function pickProviderNameFromConfig(moduleName: string, workspaceRoot: string | null): string | null {
  const envVarName = `${moduleName.toUpperCase()}_PROVIDER`;
  const envName = (process.env[envVarName] || '').trim();
  if (envName) return envName;

  if (!workspaceRoot) return null;

  const configPath = getWorkspaceConfigFilePath(workspaceRoot);
  if (!fs.existsSync(configPath)) return null;

  const cfg = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
  const settings = (cfg && cfg.extensionSettings) || {};
  const settingsObj = settings as Record<string, unknown>;
  const moduleConfig = settingsObj[moduleName] as Record<string, unknown> | undefined;
  const name = moduleConfig && typeof moduleConfig.provider === 'string' ? moduleConfig.provider : '';
  return name.trim() || null;
}

/**
 * Initialize providers for a module
 */
async function initializeProviders(
  moduleName: string,
  workspaceRoot: string | null
): Promise<{
  getProvider: (providerName?: string) => unknown | null;
}> {
  const { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });

  // Discover providers from built-in extensions (legacy: modules)
  await discoverProvidersFromModules({ extensionsDir: path.join(barducksRoot, 'extensions') });

  // Discover providers from external repositories
  if (workspaceRoot) {
    const configPath = getWorkspaceConfigFilePath(workspaceRoot);
    if (fs.existsSync(configPath)) {
      const config = readWorkspaceConfigFile<WorkspaceConfigLike>(configPath);
      if (config && config.repos && Array.isArray(config.repos)) {
        const { loadModulesFromRepo, getBarducksVersion } = await import('./lib/repo-modules.js');
        const barducksVersion = getBarducksVersion();
        
        for (const repoUrl of config.repos) {
          try {
            const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, barducksVersion);
            if (fs.existsSync(repoModulesPath)) {
              await discoverProvidersFromModules({ extensionsDir: repoModulesPath });
            }
          } catch (error) {
            // Skip failed repos, but log warning
            const err = error as Error;
            console.warn(`Warning: Failed to load providers from ${repoUrl}: ${err.message}`);
          }
        }
      }
    }
  }

  // Use module name as provider type (e.g., 'ci' module uses 'ci' provider type)
  const providerType = moduleName;
  const providers = getProvidersByType(providerType);

  return {
    getProvider: (providerName?: string) => {
      const explicit = String(providerName || '').trim();
      const configured = pickProviderNameFromConfig(moduleName, workspaceRoot);
      const selectedName = explicit || configured || (providers.length > 0 ? providers[0].name : null);

      if (!selectedName) {
        return null;
      }

      const selected = getProvider(providerType, selectedName);
      return selected || (providers.length > 0 ? providers[0] : null);
    }
  };
}

/**
 * Parse dot-notation command (e.g., "ci.fetchPR")
 */
function parseCommand(command: string): { moduleName: string; procedureName: string } | null {
  const parts = command.split('.');
  if (parts.length !== 2) {
    return null;
  }

  return {
    moduleName: parts[0],
    procedureName: parts[1]
  };
}

/**
 * Read module description from MODULE.md
 */
function readModuleDescription(modulePath: string): string | null {
  try {
    const moduleMdPath = path.join(modulePath, 'MODULE.md');
    if (!fs.existsSync(moduleMdPath)) {
      return null;
    }
    
    const content = fs.readFileSync(moduleMdPath, 'utf8');
    // Parse frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descriptionMatch) {
        return descriptionMatch[1].trim();
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate example command for a procedure
 */
async function generateExample(moduleName: string, procedureName: string, procedure: any): Promise<string> {
  try {
    const { extractYargsOptionsFromSchema } = await import('./lib/provider-cli-utils.js');
    
    const inputSchema = procedure.input;
    if (!inputSchema || typeof inputSchema !== 'object') {
      return `  api-cli ${moduleName}.${procedureName}`;
    }
    
    const { positionals, options } = extractYargsOptionsFromSchema(inputSchema);
    
    // Build example with positional arguments if present
    let example = `  api-cli ${moduleName}.${procedureName}`;
    
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
    return `  api-cli ${moduleName}.${procedureName}`;
  }
}

/**
 * Format available API methods for display
 */
async function formatAvailableMethods(unifiedAPI: any, barducksRoot: string): Promise<string> {
  let output = '';
  
  for (const [moduleName, router] of Object.entries(unifiedAPI)) {
    const procedures = (router as any).procedures;
    if (!procedures) {
      continue;
    }
    
  // Get extension description
  const modulePath = path.join(barducksRoot, 'extensions', moduleName);
    const moduleDescription = readModuleDescription(modulePath) || moduleName;
    
    output += `\n  ${moduleDescription}:\n`;
    
    // List all methods
    for (const [procedureName, procedure] of Object.entries(procedures)) {
      const proc = procedure as any;
      const title = proc.meta?.title || proc.meta?.description || procedureName;
      output += `    ${moduleName}.${procedureName}  - ${title}\n`;
    }
    
    // Generate examples for all procedures in this module
    const examples: string[] = [];
    for (const [procedureName, procedure] of Object.entries(procedures)) {
      const proc = procedure as any;
      const example = await generateExample(moduleName, procedureName, proc);
      examples.push(example.trim());
    }
    
    // Add examples section for this module
    if (examples.length > 0) {
      output += `    Examples:\n`;
      for (const example of examples) {
        output += `      ${example}\n`;
      }
    }
  }
  
  return output;
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

  // Get unified API (quiet mode to suppress side effects)
  const unifiedAPI = await getUnifiedAPI(true);

  // Parse command from arguments
  const args = argv.slice(2);
  
  // Check if help was requested or no arguments provided
  const isHelpRequested = args.length === 0 || args[0] === '--help' || args[0] === '-h';
  
  if (isHelpRequested) {
    const { barducksRoot } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });
    
    console.log('Usage: api-cli <module>.<procedure> [options]');
    console.log('\nAvailable API methods:');
    const methodsOutput = await formatAvailableMethods(unifiedAPI, barducksRoot);
    console.log(methodsOutput);
    console.log('For detailed help on a specific method, use:');
    console.log('  api-cli <module>.<procedure> --help');
    
    if (args.length === 0) {
      process.exitCode = 0;
    }
    return;
  }

  const command = args[0];
  const parsed = parseCommand(command);

  if (!parsed) {
    console.error(`Error: Invalid command format. Expected "module.procedure", got "${command}"`);
    console.error('Example: api-cli ci.fetchPR --prId 123');
    process.exitCode = 1;
    return;
  }

  const { moduleName, procedureName } = parsed;

  // Find router for module
  const router = unifiedAPI[moduleName];
  if (!router) {
    console.error(`Error: Module "${moduleName}" not found in unified API`);
    console.error('\nAvailable extensions:');
    for (const name of Object.keys(unifiedAPI)) {
      console.error(`  - ${name}`);
    }
    process.exitCode = 1;
    return;
  }

  // Check if procedure exists in router
  const procedures = (router as any).procedures;
  if (!procedures || !(procedureName in procedures)) {
    console.error(`Error: Procedure "${procedureName}" not found in module "${moduleName}"`);
    console.error(`\nAvailable procedures in ${moduleName}:`);
    if (procedures) {
      for (const procName of Object.keys(procedures)) {
        console.error(`  - ${procName}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  // Initialize providers for the module (if needed)
  // Some modules (like mcp) don't require providers
  let getModuleProvider: ((providerName?: string) => unknown | null) | null = null;
  let requiresProvider = false;
  try {
    const providersResult = await initializeProviders(moduleName, workspaceRoot);
    getModuleProvider = providersResult.getProvider;
    // Check if module actually has providers
    const testProvider = getModuleProvider();
    requiresProvider = testProvider !== null;
  } catch (error) {
    // If provider initialization fails, module doesn't require providers
    requiresProvider = false;
    getModuleProvider = () => null;
  }

  // Get the procedure
  const procedure = procedures[procedureName];
  if (!procedure) {
    console.error(`Error: Procedure "${procedureName}" not found in module "${moduleName}"`);
    process.exitCode = 1;
    return;
  }

  // Create command module manually (similar to router.toCli but for single procedure)
  const { extractYargsOptionsFromSchema, buildInputFromArgs } = await import('./lib/provider-cli-utils.js');
  const { positionals, options: schemaOptions } = extractYargsOptionsFromSchema(procedure.input as any);

  // Build command name from positionals
  let commandName = procedureName;
  if (positionals.length > 0) {
    const positionalNames = positionals.map(p => p.optional ? `[${p.name}]` : `<${p.name}>`).join(' ');
    commandName = `${procedureName} ${positionalNames}`;
  }
  const description = procedure.meta.title || procedure.meta.description || `Execute ${procedureName}`;

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
    y = y.option('provider', {
      type: 'string',
      describe: 'Provider name (overrides config/env)',
      default: ''
    });

    return y;
  };

  // Build handler
  const handler = async (args: Record<string, unknown>) => {
    // Get provider (if module requires one)
    const providerName = args.provider as string | undefined;
    const provider = requiresProvider && getModuleProvider ? getModuleProvider(providerName) : null;
    
    // Only require provider if module requires one
    if (requiresProvider && !provider) {
      throw new Error(`Provider not found${providerName ? `: ${providerName}` : ''}`);
    }

    // Build input from args
    const positionalNames = positionals.map(p => p.name);
    const input = buildInputFromArgs(args, procedure.input as any, positionalNames);

    // Call procedure through router
    const result = await router.call(procedureName as any, input, { provider });

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
  
  const yargsInstance = createYargs(['node', 'api-cli', procedureName, ...remainingArgs])
    .scriptName('api-cli')
    .strict()
    .usage(`Usage: $0 ${command} [options]`)
    .command({
      command: commandName,
      describe: description,
      builder,
      handler
    });

  // Add epilogue with available methods - this will show at the end of general help
  const { barducksRoot: barducksRootForHelp } = resolveBarducksRoot({ cwd: process.cwd(), moduleDir: __dirname });
  const methodsList = await formatAvailableMethods(unifiedAPI, barducksRootForHelp);
  if (methodsList) {
    yargsInstance.epilogue('\nAvailable API methods:\n' + methodsList);
  }

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
