#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

// Symbols
const symbols = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  search: '🔍',
  check: '✅',
  file: '📝',
  log: '📋'
};

/**
 * Print colored message to console
 */
function print(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Execute command and return output
 * @param {string} command - Command to execute
 * @param {object|string} optionsOrShell - Options object or shell string (for backward compatibility)
 * @returns {object} Result object with success, output, and error fields
 */
function executeCommand(command, optionsOrShell = {}) {
  try {
    // Handle backward compatibility: if second param is a string, treat it as shell
    let options;
    if (typeof optionsOrShell === 'string') {
      // Legacy mode: string parameter means shell
      options = { 
        encoding: 'utf8',
        shell: optionsOrShell, 
        stdio: ['ignore', 'pipe', 'pipe'] 
      };
    } else {
      // Modern mode: options object
      options = {
        encoding: 'utf8',
        stdio: optionsOrShell.stdio || ['pipe', 'pipe', 'pipe'],
        ...optionsOrShell
      };
    }
    
    const output = execSync(command, options);
    return { 
      success: true, 
      output: typeof output === 'string' ? output.trim() : output.toString().trim(),
      error: null
    };
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout ? error.stdout.toString().trim() : '',
      error: error.stderr ? error.stderr.toString().trim() : error.message
    };
  }
}

/**
 * Ask user for input (promise-based)
 * @param {string} question - Question to ask
 * @returns {Promise<string>} User's answer
 */
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Create readline interface for user input
 * @returns {readline.Interface} Readline interface
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input using existing readline interface
 * @param {readline.Interface} rl - Readline interface
 * @param {string} question - Question to ask
 * @returns {Promise<string>} User's answer
 */
function promptUser(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Check if command requires sudo
 * @param {string} command - Command to check
 * @returns {boolean} True if command starts with sudo
 */
function requiresSudo(command) {
  if (!command) return false;
  return command.trim().startsWith('sudo ');
}

/**
 * Execute interactive command (for sudo commands that need password input)
 * Uses stdio: 'inherit' to allow terminal interaction
 * @param {string} command - Command to execute
 * @returns {object} Result object with success and error fields (no output capture)
 */
function executeInteractiveCommand(command) {
  try {
    const result = spawnSync(command, {
      shell: true,
      stdio: 'inherit'
    });
    
    return {
      success: result.status === 0,
      output: null,  // Cannot capture output with stdio: 'inherit'
      error: result.status !== 0 ? `Exit code: ${result.status}` : null
    };
  } catch (error) {
    return {
      success: false,
      output: null,
      error: error.message
    };
  }
}

module.exports = {
  colors,
  symbols,
  print,
  executeCommand,
  executeInteractiveCommand,
  requiresSudo,
  askQuestion,
  createReadlineInterface,
  promptUser
};
