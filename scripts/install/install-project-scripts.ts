#!/usr/bin/env node

/**
 * Install project scripts to workspace package.json
 * 
 * Copies standard scripts (test, dev, build, start, lint) from project package.json files
 * to workspace package.json with project name prefixes (e.g., "myproject:test").
 * Additional scripts can be imported via importScripts config field.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDevduckRoot } from '../lib/devduck-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default scripts to import from projects
const DEFAULT_SCRIPTS = ['test', 'dev', 'build', 'start', 'lint'];

interface Project {
  path_in_arcadia?: string;
  src?: string;
  [key: string]: unknown;
}

interface WorkspaceConfig {
  projects?: Project[];
  importScripts?: string[];
  [key: string]: unknown;
}

interface PackageJson {
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Get project name from path_in_arcadia or src
 * e.g., "crm/frontend/services/shell" -> "shell"
 * e.g., "github.com/holiber/devduck" -> "devduck"
 * e.g., "arc://junk/user/project" -> "project"
 */
function getProjectName(projectSrcOrPath: string | undefined): string {
  if (!projectSrcOrPath) return 'unknown';
  
  // Handle arc:// URLs
  if (projectSrcOrPath.startsWith('arc://')) {
    const pathPart = projectSrcOrPath.replace('arc://', '');
    return path.basename(pathPart);
  }
  
  // Handle GitHub URLs
  if (projectSrcOrPath.includes('github.com/')) {
    const match = projectSrcOrPath.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match) {
      return match[1].replace('.git', '');
    }
  }
  
  // Handle regular paths
  return path.basename(projectSrcOrPath);
}

/**
 * Read JSON file
 */
function readJSON(filePath: string): PackageJson | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as PackageJson;
  } catch (error) {
    return null;
  }
}

/**
 * Write JSON file
 */
function writeJSON(filePath: string, data: PackageJson): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Install project scripts to workspace package.json
 * 
 * @param workspaceRoot - Path to workspace root
 * @param projects - Array of projects from workspace.config.json
 * @param config - Full workspace config object (for importScripts)
 * @param log - Optional logging function
 */
export function installProjectScripts(
  workspaceRoot: string,
  projects: Project[],
  config: WorkspaceConfig,
  log: (message: string) => void = () => {}
): void {
  if (!projects || projects.length === 0) {
    log('No projects to process for script installation');
    return;
  }

  const workspacePackageJsonPath = path.join(workspaceRoot, 'package.json');
  const projectsDir = path.join(workspaceRoot, 'projects');

  // Read workspace package.json
  const workspacePackageJson = readJSON(workspacePackageJsonPath);
  if (!workspacePackageJson) {
    log(`ERROR: Cannot read workspace package.json at ${workspacePackageJsonPath}`);
    return;
  }

  // Initialize scripts object if it doesn't exist
  if (!workspacePackageJson.scripts) {
    workspacePackageJson.scripts = {};
  }

  // Determine scripts to import
  const scriptsToImport = [...DEFAULT_SCRIPTS];
  if (config.importScripts && Array.isArray(config.importScripts)) {
    for (const scriptName of config.importScripts) {
      if (!scriptsToImport.includes(scriptName)) {
        scriptsToImport.push(scriptName);
      }
    }
  }

  log(`Scripts to import: ${scriptsToImport.join(', ')}`);

  // Get list of current project names from config
  const currentProjectNames = new Set<string>();
  for (const project of projects) {
    const projectSrcOrPath = project.path_in_arcadia || project.src;
    const projectName = getProjectName(projectSrcOrPath);
    currentProjectNames.add(projectName);
  }

  // Remove scripts for projects that are no longer in config
  const scriptsToRemove: string[] = [];
  if (workspacePackageJson.scripts) {
    for (const scriptName in workspacePackageJson.scripts) {
      // Check if script matches pattern {projectName}:{script}
      const match = scriptName.match(/^([^:]+):(.+)$/);
      if (match) {
        const projectName = match[1];
        if (!currentProjectNames.has(projectName)) {
          scriptsToRemove.push(scriptName);
        }
      }
    }
  }

  // Remove old scripts
  for (const scriptName of scriptsToRemove) {
    if (workspacePackageJson.scripts) {
      delete workspacePackageJson.scripts[scriptName];
    }
    log(`Removed script: ${scriptName}`);
  }

  // Process each project
  for (const project of projects) {
    const projectSrcOrPath = project.path_in_arcadia || project.src;
    const projectName = getProjectName(projectSrcOrPath);
    const projectPath = path.join(projectsDir, projectName);
    const projectPackageJsonPath = path.join(projectPath, 'package.json');

    // Check if project package.json exists
    if (!fs.existsSync(projectPackageJsonPath)) {
      log(`Skipping ${projectName}: package.json not found at ${projectPackageJsonPath}`);
      continue;
    }

    // Read project package.json
    const projectPackageJson = readJSON(projectPackageJsonPath);
    if (!projectPackageJson || !projectPackageJson.scripts) {
      log(`Skipping ${projectName}: invalid package.json or no scripts section`);
      continue;
    }

    // Extract scripts that match our import list
    const projectScripts = projectPackageJson.scripts;
    let scriptsAdded = 0;

    for (const scriptName of scriptsToImport) {
      if (projectScripts[scriptName]) {
        const workspaceScriptName = `${projectName}:${scriptName}`;
        // Use npm run --prefix to avoid changing current directory
        const scriptCommand = `npm run --prefix projects/${projectName} ${scriptName}`;
        
        if (!workspacePackageJson.scripts) {
          workspacePackageJson.scripts = {};
        }
        workspacePackageJson.scripts[workspaceScriptName] = scriptCommand;
        scriptsAdded++;
        log(`Added script: ${workspaceScriptName} -> ${scriptCommand}`);
      }
    }

    if (scriptsAdded > 0) {
      log(`Installed ${scriptsAdded} script(s) for project: ${projectName}`);
    } else {
      log(`No matching scripts found for project: ${projectName}`);
    }
  }

  // Write updated package.json
  writeJSON(workspacePackageJsonPath, workspacePackageJson);
  log(`Updated workspace package.json at ${workspacePackageJsonPath}`);
}

/**
 * Install API script to workspace package.json
 * 
 * Adds a single "api" script that calls api-cli.ts with all arguments
 * Usage: npm run api ci.fetchPR feature/new-feature
 * 
 * @param workspaceRoot - Path to workspace root
 * @param log - Optional logging function
 */
export function installApiScript(
  workspaceRoot: string,
  log: (message: string) => void = () => {}
): void {
  const workspacePackageJsonPath = path.join(workspaceRoot, 'package.json');
  const { devduckRoot } = resolveDevduckRoot({ cwd: workspaceRoot, moduleDir: __dirname });

  // Read workspace package.json
  const workspacePackageJson = readJSON(workspacePackageJsonPath);
  if (!workspacePackageJson) {
    log(`ERROR: Cannot read workspace package.json at ${workspacePackageJsonPath}`);
    return;
  }

  // Initialize scripts object if it doesn't exist
  if (!workspacePackageJson.scripts) {
    workspacePackageJson.scripts = {};
  }

  // Remove old API scripts (scripts that match pattern "module.procedure" and call api-cli)
  const scriptsToRemove: string[] = [];
  if (workspacePackageJson.scripts) {
    for (const scriptName in workspacePackageJson.scripts) {
      // Check if script matches pattern {module}.{procedure}
      if (scriptName.includes('.') && !scriptName.startsWith('.')) {
        // Check if it's an API script by checking if it calls api-cli
        const scriptValue = workspacePackageJson.scripts[scriptName];
        if (scriptValue && scriptValue.includes('api-cli')) {
          scriptsToRemove.push(scriptName);
        }
      }
    }
  }

  // Remove old scripts
  for (const scriptName of scriptsToRemove) {
    if (workspacePackageJson.scripts) {
      delete workspacePackageJson.scripts[scriptName];
    }
    log(`Removed old API script: ${scriptName}`);
  }

  // Calculate relative path from workspace root to devduck scripts
  const apiCliPath = path.relative(workspaceRoot, path.join(devduckRoot, 'scripts', 'api-cli.ts'));
  const apiCliCommand = apiCliPath.startsWith('.') ? apiCliPath : `./${apiCliPath}`;

  // Add or update the "api" script
  // Arguments will be passed through npm run api arg1 arg2
  workspacePackageJson.scripts['api'] = `npx tsx ${apiCliCommand}`;

  // Write updated package.json
  writeJSON(workspacePackageJsonPath, workspacePackageJson);
  log(`Added/updated API script: api -> npx tsx ${apiCliCommand} "$@"`);
}

