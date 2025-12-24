import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import type { Argv } from 'yargs';

/**
 * Standard stdout EPIPE handling.
 * Useful when piping JSON output to tools like `head`.
 */
export function installEpipeHandler(): void {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error && error.code === 'EPIPE') process.exit(0);
  });
}

/**
 * Create a preconfigured yargs instance for our scripts.
 *
 * Defaults:
 * - help on -h/--help
 * - recommendCommands for better UX
 *
 * NOTE: individual scripts may still choose to enable/disable strict parsing.
 */
export function createYargs(argv: string[] = process.argv): Argv {
  return yargs(hideBin(argv))
    .help()
    .alias('help', 'h')
    .recommendCommands();
}

