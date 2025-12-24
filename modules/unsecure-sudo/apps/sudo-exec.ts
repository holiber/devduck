#!/usr/bin/env node

/**
 * Sudo command execution app
 * 
 * WARNING: This is a temporary solution for projects requiring sudo commands.
 * Use with caution and only when absolutely necessary.
 * 
 * Usage: tsx sudo-exec.ts <command>
 */

import { executeCommand } from '../../../scripts/utils.js';
import { createYargs } from '../../../scripts/lib/cli.js';

async function main(argv: string[] = process.argv): Promise<unknown> {
  const parsed = await createYargs(argv)
    .scriptName('sudo-exec')
    // Allow passing arbitrary commands without yargs treating flags as options.
    .parserConfiguration({ 'unknown-options-as-args': true })
    .strict(false)
    .usage('Usage: $0 <command...>\n\nExamples:\n  $0 ls -la\n  $0 -- apt-get update')
    .command(
      '$0 <cmd..>',
      'Execute a command via sudo (temporary escape hatch).',
      (y) =>
        y.positional('cmd', {
          describe: 'Command to execute (including arguments)',
          type: 'string',
          array: true,
        }),
      (args) => {
        const command = (args.cmd as string[] || []).join(' ').trim();
        if (!command) {
          // yargs should enforce cmd.., but keep a defensive check.
          throw new Error('Command is required');
        }

        console.warn('WARNING: Executing command with sudo. This is a temporary solution.');
        console.log(`Executing: sudo ${command}`);

        const result = executeCommand(`sudo ${command}`, '/bin/bash');

        if (result.success) {
          if (result.output) console.log(result.output);
          process.exit(0);
        } else {
          console.error(`Error: ${result.error || 'Command failed'}`);
          if (result.output) console.error(result.output);
          process.exit(1);
        }
      },
    )
    .parseAsync();

  return parsed;
}

// Run main function if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  main().catch((e: unknown) => {
    const error = e as { message?: string };
    console.error(error && error.message ? error.message : String(e));
    process.exit(1);
  });
}

