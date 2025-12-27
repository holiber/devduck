import fs from 'fs';
import path from 'path';
import { readEnvFile } from '../lib/env.js';
import {
  createReadlineInterface,
  executeCommand,
  executeInteractiveCommand,
  print,
  promptUser,
  requiresSudo,
  symbols
} from '../utils.js';
import { checkFileExists, isFilePath } from './installer-utils.js';
import { makeHttpRequest } from './http-utils.js';
import { createVariableReplacer } from './config-utils.js';

export type CheckItem = {
  name: string;
  description?: string;
  test?: string;
  install?: string;
  mcpSettings?: Record<string, unknown>;
  _execCwd?: string;
  [key: string]: unknown;
};

export type CheckResult = {
  name: string;
  passed: boolean | null;
  version?: string | null;
  note?: string;
  filePath?: string;
  tier?: string;
  skipped?: boolean;
  statusCode?: number;
  error?: string;
};

export function createCheckEngine(params: {
  workspaceRoot: string;
  projectRoot: string;
  envFilePath: string;
  projectsDir: string;
  autoYes: boolean;
  log: (message: string) => void;
}): {
  checkCommand: (item: CheckItem, context?: string | null, skipInstall?: boolean) => Promise<CheckResult>;
  checkHttpAccess: (item: CheckItem, context?: string | null) => Promise<CheckResult>;
  replaceVariablesWithLog: (str: string, env: Record<string, string>) => string;
  replaceVariablesInObjectWithLog: (obj: unknown, env: Record<string, string>) => unknown;
} {
  const { workspaceRoot, projectRoot, envFilePath, projectsDir, autoYes, log } = params;

  const { replaceVariablesWithLog, replaceVariablesInObjectWithLog } = createVariableReplacer({
    log,
    print,
    symbols
  });

  async function installSoftware(item: CheckItem): Promise<boolean> {
    const { name, description, install } = item;

    print(`  ${symbols.info} Installation command found for ${name}`, 'cyan');
    log(`Installation command: ${install}`);

    // Ask user if they want to install (unless running in non-interactive mode)
    let answer = 'y';
    if (!autoYes) {
      const rl = createReadlineInterface();
      answer = await promptUser(rl, `  Do you want to install ${name}? (y/n) [y]: `);
      rl.close();
    } else {
      print(`  ${symbols.info} Non-interactive mode: auto-installing ${name}`, 'cyan');
      log(`Non-interactive mode: auto-installing ${name}`);
    }

    if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
      print(`  ${symbols.warning} Installation skipped by user`, 'yellow');
      log(`Installation skipped by user`);
      return false;
    }

    print(`  Installing ${name}...`, 'cyan');
    log(`Executing installation command: ${install}`);

    try {
      const isSudo = requiresSudo(install);
      const result = isSudo
        ? executeInteractiveCommand(install)
        : executeCommand(install, { shell: '/bin/bash', cwd: item._execCwd });

      if (result.success) {
        print(`  ${symbols.success} Installation command completed`, 'green');
        log(`  Installation SUCCESS - Output: ${result.output || '(interactive)'}`);
        return true;
      }

      print(`  ${symbols.error} Installation failed: ${result.error || 'Command failed'}`, 'red');
      log(`  Installation FAILED - Error: ${result.error || 'Command failed'}`);
      if (result.output) {
        log(`  Installation output: ${result.output}`);
      }
      return false;
    } catch (error) {
      const err = error as Error;
      print(`  ${symbols.error} Installation error: ${err.message}`, 'red');
      log(`  Installation ERROR - ${err.message}`);
      return false;
    }
  }

  async function checkCommand(
    item: CheckItem,
    context: string | null = null,
    skipInstall = false
  ): Promise<CheckResult> {
    const { name, description, test, install } = item;
    const contextSuffix = context ? ` [${context}]` : '';

    print(`Checking ${name}${contextSuffix}...`, 'cyan');
    log(`Checking command: ${name} (${description})`);

    // Read .env file for variable substitution
    const env = readEnvFile(envFilePath);

    // Default test for MCP checks: if no explicit test provided, verify MCP via tools/list
    // using scripts/test-mcp.js against the generated .cursor/mcp.json configuration.
    let effectiveTest = test;
    if ((!effectiveTest || typeof effectiveTest !== 'string' || !effectiveTest.trim()) && item.mcpSettings && name) {
      effectiveTest = `node "${path.join(projectRoot, 'scripts', 'test-mcp.js')}" "${name}"`;
    }

    if (!effectiveTest) {
      print(`${symbols.warning} ${name} - No test command specified`, 'yellow');
      if (description) {
        print(description, 'yellow');
      }
      log(`No test command specified for ${name}`);
      return {
        name,
        passed: false,
        version: null,
        note: 'No test command specified'
      };
    }

    const testWithVars = replaceVariablesWithLog(effectiveTest, env);
    const installWithVars = install ? replaceVariablesWithLog(install, env) : install;

    try {
      if (isFilePath(testWithVars)) {
        log(`File/directory path: ${testWithVars}`);

        const fileCheck = checkFileExists(testWithVars, { baseDir: projectRoot });

        if (fileCheck.exists && (fileCheck.isFile || fileCheck.isDirectory)) {
          const typeLabel = fileCheck.isDirectory ? 'Directory' : 'File';
          print(`${symbols.success} ${name} - OK`, 'green');
          log(`Result: SUCCESS - ${typeLabel} exists: ${fileCheck.path}`);

          return {
            name,
            passed: true,
            version: fileCheck.isDirectory ? 'directory exists' : 'file exists',
            filePath: fileCheck.path
          };
        }

        print(`${symbols.error} ${name} - Path not found: ${testWithVars}`, 'red');
        if (description) {
          print(description, 'red');
        }
        const docs = (item as { docs?: string }).docs;
        if (docs) {
          print(docs, 'red');
        }
        log(`Result: FAILED - Path not found: ${fileCheck.path}`);

        if (installWithVars && !skipInstall) {
          const itemWithVars = { ...item, install: installWithVars };
          const installed = await installSoftware(itemWithVars);

          if (installed) {
            print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
            log(`Re-checking ${name} after installation`);

            const recheckFile = checkFileExists(testWithVars, { baseDir: projectRoot });
            if (recheckFile.exists && (recheckFile.isFile || recheckFile.isDirectory)) {
              const typeLabel = recheckFile.isDirectory ? 'Directory' : 'File';
              print(`${symbols.success} ${name} - OK`, 'green');
              log(`Re-check SUCCESS - ${typeLabel} exists: ${recheckFile.path}`);

              return {
                name,
                passed: true,
                version: recheckFile.isDirectory ? 'directory exists' : 'file exists',
                filePath: recheckFile.path,
                note: 'Installed during setup'
              };
            }

            print(`${symbols.warning} ${name} - Installation completed but path not found`, 'yellow');
            if (description) {
              print(description, 'yellow');
            }
            log(`Re-check FAILED - Installation may have succeeded but path not found`);

            return {
              name,
              passed: false,
              version: null,
              note: 'Installation attempted but path not found'
            };
          }
        }

        return {
          name,
          passed: false,
          version: null,
          filePath: fileCheck.path
        };
      }

      // It's a command - execute it
      log(`Command: ${testWithVars}`);

      // Special handling for nvm - need to source it first
      let command = testWithVars;
      if (name === 'nvm') {
        command = `source ~/.nvm/nvm.sh && ${testWithVars}`;
      }

      // Handle API calls (commands starting with "api ")
      let apiCommandHandled = false;
      if (command.trim().startsWith('api ')) {
        const apiCommand = command.trim().substring(4); // Remove "api " prefix
        command = `npm run call -- ${apiCommand}`;
        apiCommandHandled = true;
      }

      // For project checks, run command from projects/<projectName> if it exists.
      // For API commands, always run from workspace root.
      const execOptions: { cwd?: string } = {};
      if (apiCommandHandled) {
        execOptions.cwd = workspaceRoot || process.cwd();
      } else if (context) {
        const projectCwd = path.join(projectsDir, context);
        try {
          // eslint-disable-next-line no-sync
          if (fs.existsSync(projectCwd) && fs.statSync(projectCwd).isDirectory()) {
            execOptions.cwd = projectCwd;
          }
        } catch {
          // ignore
        }
      }

      const isSudo = requiresSudo(command);
      const result = isSudo ? executeInteractiveCommand(command) : executeCommand(command, execOptions);

      // For API commands, check if output is "true" to determine success
      let commandSuccess = result.success;
      if (apiCommandHandled && result.success) {
        const resultValue = result.output?.trim().split('\n').pop()?.trim() || '';
        commandSuccess = resultValue === 'true';
      }

      if (commandSuccess) {
        const isTestCheck = item.type === 'test' || (item.type === 'auth' && item.test);
        const version = isSudo ? 'passed' : (result.output || (isTestCheck ? 'OK' : 'unknown'));
        print(`${symbols.success} ${name} - ${version}`, 'green');
        log(`Result: SUCCESS - Version: ${version}`);
        return { name, passed: true, version };
      }

      const itemVar = (item as { var?: string }).var;
      const isAuth = item.type === 'auth' && itemVar;
      let errorLabel: string;
      if (item.type === 'auth' && itemVar && testWithVars && testWithVars.trim().startsWith('api ')) {
        const returnValue = result.output || result.error || 'failed';
        errorLabel = `the ${itemVar} exist but "${testWithVars}" returned ${returnValue}`;
      } else if (item.type === 'auth' && itemVar) {
        errorLabel = `${itemVar} check failed`;
      } else {
        errorLabel = 'Not installed';
      }

      print(`${symbols.error} ${name} - ${errorLabel}`, 'red');
      if (description) {
        print(description, 'red');
      }
      const docs = (item as { docs?: string }).docs;
      if (docs) {
        print(docs, 'red');
      }
      log(`Result: FAILED - ${errorLabel}${result.error ? ` (${result.error})` : ''}`);

      if (install && !skipInstall) {
        const itemWithCwd = { ...item, _execCwd: execOptions.cwd };
        const installed = await installSoftware(itemWithCwd);
        if (installed) {
          print(`Re-checking ${name}${contextSuffix}...`, 'cyan');
          log(`Re-checking ${name} after installation`);

          const recheckResult = isSudo
            ? executeInteractiveCommand(command)
            : executeCommand(command, execOptions);

          if (recheckResult.success) {
            const isTestCheck = item.type === 'test' || (item.type === 'auth' && item.test);
            const version = isSudo ? 'passed' : (recheckResult.output || (isTestCheck ? 'OK' : 'unknown'));
            print(`${symbols.success} ${name} - ${version}`, 'green');
            log(`Re-check SUCCESS - Version: ${version}`);
            return { name, passed: true, version, note: 'Installed during setup' };
          }

          const retryErrorLabel = isAuth ? `${itemVar} check failed` : 'Installation completed but verification failed';
          print(`${symbols.warning} ${name} - ${retryErrorLabel}`, 'yellow');
          if (description) {
            print(description, 'yellow');
          }
          log(`Re-check FAILED - ${retryErrorLabel}`);
          return {
            name,
            passed: false,
            version: null,
            note: isAuth ? retryErrorLabel : 'Installation attempted but verification failed'
          };
        }
      }

      return {
        name,
        passed: false,
        version: null,
        note: isAuth ? `${itemVar} check failed` : undefined
      };
    } catch (error) {
      const err = error as Error;
      print(`${symbols.error} ${name} - Error: ${err.message}`, 'red');
      if (description) {
        print(description, 'red');
      }
      const docs = (item as { docs?: string }).docs;
      if (docs) {
        print(docs, 'red');
      }
      log(`Result: ERROR - ${err.message}`);
      return { name, passed: false, version: null };
    }
  }

  async function checkHttpAccess(item: CheckItem, context: string | null = null): Promise<CheckResult> {
    const { name, description, test } = item;
    const contextSuffix = context ? ` [${context}]` : '';

    print(`Checking ${name}${contextSuffix}...`, 'cyan');
    log(`Checking HTTP access: ${name} (${description})`);
    log(`Request: ${test}`);

    try {
      const parts = test.trim().split(/\s+/);
      const method = parts[0] || 'GET';
      const url = parts.slice(1).join(' ');

      if (!url) {
        throw new Error('Invalid test format: missing URL');
      }

      const result = await makeHttpRequest(method, url);

      if (result.success) {
        print(`${symbols.success} ${name} - OK`, 'green');
        log(`Result: SUCCESS - Status: ${result.statusCode}`);
        return { name, passed: true, statusCode: result.statusCode ?? undefined };
      }

      print(`${symbols.error} ${name} - Failed (${result.statusCode || result.error})`, 'red');
      if (description) {
        print(description, 'red');
      }
      const docs = (item as { docs?: string }).docs;
      if (docs) {
        print(docs, 'red');
      }
      log(`Result: FAILED - Status: ${result.statusCode || 'N/A'}, Error: ${result.error || 'N/A'}`);
      return { name, passed: false, error: result.error || `HTTP ${result.statusCode}` };
    } catch (error) {
      const err = error as Error;
      print(`${symbols.error} ${name} - Error: ${err.message}`, 'red');
      if (description) {
        print(description, 'red');
      }
      const docs = (item as { docs?: string }).docs;
      if (docs) {
        print(docs, 'red');
      }
      log(`Result: ERROR - ${err.message}`);
      return { name, passed: false, error: err.message };
    }
  }

  return {
    checkCommand,
    checkHttpAccess,
    replaceVariablesWithLog,
    replaceVariablesInObjectWithLog
  };
}


