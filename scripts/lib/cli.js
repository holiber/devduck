const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

/**
 * Standard stdout EPIPE handling.
 * Useful when piping JSON output to tools like `head`.
 */
function installEpipeHandler() {
  process.stdout.on('error', (error) => {
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
function createYargs(argv = process.argv) {
  return yargs(hideBin(argv))
    .help()
    .alias('help', 'h')
    .recommendCommands();
}

module.exports = {
  createYargs,
  installEpipeHandler,
};

