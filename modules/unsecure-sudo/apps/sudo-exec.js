#!/usr/bin/env node

/**
 * Sudo command execution app
 * 
 * WARNING: This is a temporary solution for projects requiring sudo commands.
 * Use with caution and only when absolutely necessary.
 * 
 * Usage: node sudo-exec.js <command>
 */

const { spawnSync } = require('child_process');
const { executeCommand } = require('../../core/scripts/utils');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: sudo-exec.js <command>');
  process.exit(1);
}

const command = args.join(' ');
console.warn('WARNING: Executing command with sudo. This is a temporary solution.');
console.log(`Executing: sudo ${command}`);

const result = executeCommand(`sudo ${command}`, '/bin/bash');

if (result.success) {
  if (result.output) {
    console.log(result.output);
  }
  process.exit(0);
} else {
  console.error(`Error: ${result.error || 'Command failed'}`);
  if (result.output) {
    console.error(result.output);
  }
  process.exit(1);
}

