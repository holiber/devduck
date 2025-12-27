import fs from 'fs';
import path from 'path';
import { readJSON } from '../lib/config.js';
import { setupEnvFile } from './env.js';
import { generateMcpJson, checkMcpServers } from './mcp.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import { print, symbols } from '../utils.js';

export async function runLegacyInstallationCheck(params: {
  workspaceRoot: string;
  projectRoot: string;
  configFilePath: string;
  autoYes: boolean;
  log: (message: string) => void;
}): Promise<void> {
  const { workspaceRoot, projectRoot, configFilePath, autoYes, log } = params;

  // Setup .env file if needed
  const configForEnv = readJSON(configFilePath);
  if (configForEnv) {
    await setupEnvFile(workspaceRoot, configForEnv as WorkspaceConfig, {
      autoYes,
      log,
      print,
      symbols
    });
  }

  // Read configuration
  const config = readJSON(configFilePath);
  if (!config) {
    print(`${symbols.error} Error: Cannot read ${configFilePath}`, 'red');
    log(`ERROR: Cannot read configuration file: ${configFilePath}`);
    process.exit(1);
  }

  log(`Configuration loaded from: ${configFilePath}`);

  // Load module checks early (before generating mcp.json) to include their mcpSettings
  let moduleChecks: Array<{ name?: string; mcpSettings?: Record<string, unknown> }> = [];
  try {
    const { getAllModules, resolveModules, loadModuleFromPath } = await import('./module-resolver.js');
    const { loadModulesFromRepo, getDevduckVersion } = await import('../lib/repo-modules.js');

    // Load local modules
    const allModules = getAllModules();
    const resolvedModules = resolveModules(config as WorkspaceConfig, allModules);
    moduleChecks = resolvedModules.flatMap((module) => module.checks || []);

    // Also load modules from external repositories (for MCP generation only)
    const repos = (config as WorkspaceConfig).repos;
    if (repos && Array.isArray(repos) && repos.length > 0) {
      const devduckVersion = getDevduckVersion();
      for (const repoUrl of repos) {
        try {
          const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
          if (fs.existsSync(repoModulesPath)) {
            const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
            for (const entry of repoModuleEntries) {
              if (entry.isDirectory()) {
                const modulePath = path.join(repoModulesPath, entry.name);
                const module = loadModuleFromPath(modulePath, entry.name);
                if (module && module.checks) {
                  moduleChecks.push(...module.checks);
                }
              }
            }
          }
        } catch {
          // Continue with other repos
        }
      }
    }
  } catch {
    // Continue without module checks
  }

  // Generate mcp.json
  const mcpServers = generateMcpJson(workspaceRoot, { log, print, symbols, moduleChecks });

  // Check MCP servers if they were generated
  let mcpResults: unknown[] = [];
  if (mcpServers) {
    mcpResults = await checkMcpServers(mcpServers, workspaceRoot, { log, print, symbols });
  }

  // Import step functions (legacy)
  const { runStep1CheckEnv } = await import('./install-1-check-env.js');
  const { runStep2DownloadRepos } = await import('./install-2-download-repos.js');
  const { runStep3DownloadProjects } = await import('./install-3-download-projects.js');
  const { runStep4CheckEnvAgain } = await import('./install-4-check-env-again.js');
  const { runStep5SetupModules } = await import('./install-5-setup-modules.js');
  const { runStep6SetupProjects } = await import('./install-6-setup-projects.js');
  const { runStep7VerifyInstallation } = await import('./install-7-verify-installation.js');
  const { loadInstallState, saveInstallState } = await import('./install-state.js');

  // Step 1: Check environment variables
  const step1Result = await runStep1CheckEnv(workspaceRoot, projectRoot, log);
  if (step1Result.validationStatus === 'needs_input') {
    process.exit(0);
  }
  if (step1Result.validationStatus === 'failed') {
    process.exit(1);
  }

  // Step 2: Download repositories
  await runStep2DownloadRepos(workspaceRoot, log);

  // Step 3: Download projects
  await runStep3DownloadProjects(workspaceRoot, log);

  // Step 4: Check environment again
  const step4Result = await runStep4CheckEnvAgain(workspaceRoot, projectRoot, log);
  if (step4Result.validationStatus === 'needs_input') {
    process.exit(0);
  }
  if (step4Result.validationStatus === 'failed') {
    process.exit(1);
  }

  // Step 5: Setup modules
  const step5Result = await runStep5SetupModules(workspaceRoot, projectRoot, log, autoYes);

  // Step 6: Setup projects
  const step6Result = await runStep6SetupProjects(workspaceRoot, projectRoot, log, autoYes);

  // Step 7: Verify installation
  const step7Result = await runStep7VerifyInstallation(workspaceRoot, projectRoot, log, autoYes);

  // Install project scripts to workspace package.json
  try {
    const { installProjectScripts } = await import('./install-project-scripts.js');
    print(`\n${symbols.info} Installing project scripts to workspace package.json...`, 'cyan');
    log(`Installing project scripts to workspace package.json`);
    installProjectScripts(workspaceRoot, (config as { projects?: unknown[] }).projects || [], config, log);
    print(`  ${symbols.success} Project scripts installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install project scripts: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install project scripts: ${err.message}\n${err.stack}`);
  }

  // Install API script to workspace package.json
  try {
    const { installApiScript } = await import('./install-project-scripts.js');
    print(`\n${symbols.info} Installing API script to workspace package.json...`, 'cyan');
    log(`Installing API script to workspace package.json`);
    installApiScript(workspaceRoot, log);
    print(`  ${symbols.success} API script installed`, 'green');
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.warning} Failed to install API script: ${err.message}`, 'yellow');
    log(`ERROR: Failed to install API script: ${err.message}\n${err.stack}`);
  }

  // Collect results from all steps for summary
  const state = loadInstallState(workspaceRoot);

  // Build installedModules map from step 5 results
  const installedModules: Record<string, string> = {};
  if (step5Result.modules) {
    for (const module of step5Result.modules) {
      if (module.name && module.path) {
        installedModules[module.name] = module.path;
      }
    }
  }

  state.installedModules = installedModules;
  state.installedAt = new Date().toISOString();
  state.mcpServers = mcpResults;
  state.checks = step7Result.results;
  state.projects = step6Result.projects;
  saveInstallState(workspaceRoot, state);

  // Summary
  const allChecks = step7Result.results;
  const checksPassed = allChecks.filter((c: { passed?: boolean | null }) => c.passed === true).length;
  const checksSkipped = allChecks.filter((c: { skipped?: boolean }) => c.skipped === true).length;
  const checksTotal = allChecks.length;

  // Calculate MCP statistics
  let mcpWorking = 0;
  let mcpTotal = 0;
  let mcpOptionalFailed = 0;
  if (mcpResults && Array.isArray(mcpResults)) {
    mcpTotal = mcpResults.length;
    mcpWorking = mcpResults.filter((m: { working?: boolean }) => m.working).length;
    mcpOptionalFailed = mcpResults.filter((m: { working?: boolean; optional?: boolean }) => !m.working && m.optional).length;
  }

  const mcpRequiredTotal = mcpResults ? (mcpResults as Array<{ optional?: boolean }>).filter((m) => !m.optional).length : 0;
  const mcpRequiredWorking = mcpResults
    ? (mcpResults as Array<{ working?: boolean; optional?: boolean }>).filter((m) => !m.optional && m.working).length
    : 0;

  // Calculate project statistics
  const projectsTotal = step6Result.projects ? step6Result.projects.length : 0;
  const projectsWithSymlink = step6Result.projects ? step6Result.projects.filter((p: { symlink?: { error?: string } }) => p.symlink && !p.symlink.error).length : 0;
  let projectChecksPassed = 0;
  let projectChecksTotal = 0;
  let projectChecksSkipped = 0;
  if (step6Result.projects) {
    for (const project of step6Result.projects) {
      if (project.checks) {
        projectChecksTotal += project.checks.length;
        projectChecksPassed += project.checks.filter((c: { passed?: boolean | null }) => c.passed === true).length;
        projectChecksSkipped += project.checks.filter((c: { skipped?: boolean }) => c.skipped === true).length;
      }
    }
  }

  print(`\n${symbols.check} Installation check completed!`, 'green');
  const checksRan = checksTotal - checksSkipped;
  let checksMsg = `  Checks: ${checksPassed}/${checksRan} passed`;
  if (checksSkipped > 0) {
    checksMsg += ` (${checksSkipped} skipped)`;
  }
  const checksColor = checksPassed === checksRan ? 'green' : 'red';
  print(checksMsg, checksColor);
  if (checksPassed !== checksRan) {
    print(`  ${symbols.error} Some checks failed. Please review the output above.`, 'red');
  }
  if (mcpTotal > 0) {
    if (mcpRequiredTotal > 0) {
      const mcpStatus = mcpRequiredWorking === mcpRequiredTotal ? 'green' : 'yellow';
      let mcpMsg = `  MCP Servers: ${mcpRequiredWorking}/${mcpRequiredTotal} required working`;
      if (mcpOptionalFailed > 0) {
        mcpMsg += ` (${mcpOptionalFailed} optional failed)`;
      }
      print(mcpMsg, mcpStatus);
    } else if (mcpOptionalFailed > 0) {
      print(`  MCP Servers: ${mcpWorking}/${mcpTotal} working (${mcpOptionalFailed} optional failed)`, 'yellow');
    } else {
      print(`  MCP Servers: ${mcpWorking}/${mcpTotal} working`, 'green');
    }
  }
  if (projectsTotal > 0) {
    print(`  Projects: ${projectsWithSymlink}/${projectsTotal} linked`, projectsWithSymlink === projectsTotal ? 'green' : 'red');
    if (projectChecksTotal > 0) {
      const projectChecksRan = projectChecksTotal - projectChecksSkipped;
      let projectChecksMsg = `  Project checks: ${projectChecksPassed}/${projectChecksRan} passed`;
      if (projectChecksSkipped > 0) {
        projectChecksMsg += ` (${projectChecksSkipped} skipped)`;
      }
      print(projectChecksMsg, projectChecksPassed === projectChecksRan ? 'green' : 'yellow');
    }
  }
  print(`\n${symbols.file} Results saved to .cache/install-state.json`, 'cyan');
  print(`${symbols.log} Logs written to .cache/install.log\n`, 'cyan');

  log(`\n=== Installation check completed at ${new Date().toISOString()} ===\n`);

  const mcpRequiredFailed = mcpResults
    ? (mcpResults as Array<{ working?: boolean; optional?: boolean }>).filter((m) => !m.optional && !m.working).length
    : 0;
  const checksFailed = allChecks.filter((c: { passed?: boolean | null }) => c.passed === false).length;
  const hasFailures = checksFailed > 0 || mcpRequiredFailed > 0;

  if (hasFailures) {
    process.exit(1);
  }
}


