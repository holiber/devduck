import { readJSON } from '../lib/config.js';
import { readEnvFile } from '../lib/env.js';
import { print, symbols } from '../utils.js';
import { getProjectName, isHttpRequest } from './installer-utils.js';
import { processCheck } from './process-check.js';
import { createCheckEngine, type CheckItem, type CheckResult } from './check-engine.js';

export async function runSelectedChecks(params: {
  checkNames: string[];
  testOnly: boolean;
  configFilePath: string;
  envFilePath: string;
  workspaceRoot: string;
  projectRoot: string;
  projectsDir: string;
  log: (message: string) => void;
  autoYes: boolean;
}): Promise<void> {
  const { checkNames, testOnly, configFilePath, envFilePath, workspaceRoot, projectRoot, projectsDir, log, autoYes } =
    params;

  print(`\n${symbols.search} Running selected checks: ${checkNames.join(', ')}...\n`, 'blue');
  log(`Running selected checks: ${checkNames.join(', ')} (testOnly: ${testOnly})`);

  const config = readJSON(configFilePath);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${configFilePath}`, 'red');
    log(`ERROR: Cannot read configuration file: ${configFilePath}`);
    process.exit(1);
  }

  const env = readEnvFile(envFilePath);

  const allChecks: Array<CheckItem & { source: 'config' | 'project'; projectName?: string }> = [];

  if (config.checks && Array.isArray(config.checks)) {
    for (const check of config.checks) {
      if (checkNames.includes(check.name)) {
        allChecks.push({ ...(check as CheckItem), source: 'config' });
      }
    }
  }

  if (config.projects && Array.isArray(config.projects)) {
    for (const project of config.projects) {
      if (project.checks && Array.isArray(project.checks)) {
        const projectName = getProjectName(project.src);
        for (const check of project.checks) {
          if (checkNames.includes(check.name)) {
            allChecks.push({ ...(check as CheckItem), source: 'project', projectName });
          }
        }
      }
    }
  }

  if (allChecks.length === 0) {
    print(`${symbols.warning} No checks found with names: ${checkNames.join(', ')}`, 'yellow');
    log(`No checks found with names: ${checkNames.join(', ')}`);
    process.exit(1);
  }

  const foundNames = allChecks.map((c) => c.name);
  const missingNames = checkNames.filter((name) => !foundNames.includes(name));
  if (missingNames.length > 0) {
    print(`${symbols.warning} Some checks not found: ${missingNames.join(', ')}`, 'yellow');
    log(`Some checks not found: ${missingNames.join(', ')}`);
  }

  print(`\n${symbols.info} Found ${allChecks.length} check(s) to run...\n`, 'cyan');

  const results: CheckResult[] = [];
  const engine = createCheckEngine({
    workspaceRoot,
    projectRoot,
    envFilePath,
    projectsDir,
    autoYes,
    log
  });

  for (const check of allChecks) {
    const contextType = check.source === 'project' ? 'project' : 'workspace';
    const contextName = check.projectName || null;

    const checkWithVars = engine.replaceVariablesInObjectWithLog(check, env) as CheckItem & {
      skip?: boolean;
      description?: string;
    };

    if (checkWithVars.skip === true) {
      const prefix = contextName ? `[${contextName}] ` : '';
      print(`  ${symbols.warning} ${prefix}${check.name}: skipped`, 'yellow');
      log(`${prefix}CHECK SKIPPED: ${check.name}`);
      results.push({
        name: check.name,
        passed: null,
        skipped: true,
        note: check.description || ''
      });
      continue;
    }

    const checkResult = await processCheck(contextType, contextName, checkWithVars, {
      skipInstall: testOnly,
      workspaceRoot,
      checkCommand: engine.checkCommand,
      checkHttpAccess: engine.checkHttpAccess,
      isHttpRequest,
      replaceVariablesInObjectWithLog: engine.replaceVariablesInObjectWithLog
    });
    results.push(checkResult);
  }

  const passed = results.filter((r) => r.passed === true).length;
  const failed = results.filter((r) => r.passed === false).length;
  const skipped = results.filter((r) => r.skipped === true).length;
  const total = results.length;

  print(`\n${symbols.check} Check execution completed!`, 'green');
  print(`  Total: ${total} check(s)`, 'cyan');
  print(`  Passed: ${passed}`, passed === total ? 'green' : 'yellow');
  if (failed > 0) {
    print(`  Failed: ${failed}`, 'red');
  }
  if (skipped > 0) {
    print(`  Skipped: ${skipped}`, 'yellow');
  }

  log(`\n=== Check execution completed at ${new Date().toISOString()} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}


