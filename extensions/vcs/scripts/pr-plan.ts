#!/usr/bin/env node

/**
 * PR Plan Management Script
 * 
 * Handles PR plan file operations:
 * - Creating PR plans
 * - Archiving plans after commit/PR creation
 * - Validating plan structure
 * 
 * This script is part of the vcs module and should be used by PR workflow.
 */

import fs from 'fs';
import path from 'path';
import { createYargs } from '../../../scripts/lib/cli.js';
import { findWorkspaceRoot } from '../../../scripts/lib/workspace-root.js';

/**
 * Get PR plan directory path
 */
export function getPlanDir(): string {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Workspace root not found. Make sure you are in a devduck workspace.');
  }
  return path.join(workspaceRoot, '.cache', 'pr');
}

/**
 * Get trash directory path
 */
export function getTrashDir(): string {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Workspace root not found. Make sure you are in a devduck workspace.');
  }
  return path.join(workspaceRoot, '.cache', 'trash');
}

/**
 * Make timestamp for filename
 */
export function makeTimestampForFilename(d: Date = new Date()): string {
  return d.toISOString().replace(/:/g, '-');
}

/**
 * Archive PR plan file to trash directory
 * @param planPath - Path to plan file
 * @returns Path to archived file or null
 */
export function archivePlanFile(planPath: string): string | null {
  if (!fs.existsSync(planPath)) {
    console.warn(`Plan file does not exist: ${planPath}`);
    return null;
  }

  const trashDir = getTrashDir();
  fs.mkdirSync(trashDir, { recursive: true });
  
  const base = path.basename(planPath).replace(/\.md$/i, '');
  const ts = makeTimestampForFilename();
  const dst = path.join(trashDir, `${base}.${ts}.md`);
  
  fs.renameSync(planPath, dst);
  return dst;
}

/**
 * Get plan file path for a branch
 * @param branchName - Branch name
 * @returns Path to plan file
 */
export function getPlanPath(branchName: string): string {
  const planDir = getPlanDir();
  const safeBranchName = branchName.replace(/[\/\\]/g, '-');
  return path.join(planDir, `${safeBranchName}.plan.md`);
}

/**
 * Read plan file
 * @param planPath - Path to plan file
 * @returns Plan content
 */
export function readPlanFile(planPath: string): string {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }
  return fs.readFileSync(planPath, 'utf8');
}

interface PlanTitleAndDescription {
  title: string;
  description: string;
}

/**
 * Parse plan title and description from plan content
 * @param content - Plan file content
 * @returns Object with title and description
 */
export function parsePlanTitleAndDescription(content: string): PlanTitleAndDescription {
  const lines = content.split('\n');
  let title = '';
  let description = '';
  let inDescription = false;
  const descriptionLines: string[] = [];

  // Get title from first line (should start with #)
  if (lines.length > 0 && lines[0].startsWith('#')) {
    title = lines[0].replace(/^#+\s*/, '').trim();
  }

  // Find PR Description section
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^##\s+PR\s+Description/i)) {
      inDescription = true;
      continue;
    }
    if (inDescription) {
      // Stop at next ## section
      if (line.match(/^##\s+/) && !line.match(/^##\s+PR\s+Description/i)) {
        break;
      }
      // Skip empty lines at the start
      if (descriptionLines.length === 0 && line.trim() === '') {
        continue;
      }
      descriptionLines.push(line);
    }
  }

  description = descriptionLines.join('\n').trim();

  return { title, description };
}

interface PlanValidationResult {
  ok: boolean;
  errors: string[];
  title: string;
  description: string;
}

/**
 * Validate plan has title and description
 * @param planPath - Path to plan file
 * @returns Validation result
 */
export function validatePlan(planPath: string): PlanValidationResult {
  try {
    const content = readPlanFile(planPath);
    const parsed = parsePlanTitleAndDescription(content);
    const errors: string[] = [];
    
    if (!parsed.title) {
      errors.push('Plan title is empty.');
    }
    if (!parsed.description) {
      errors.push('Plan PR Description block is empty or missing.');
    }
    
    return {
      ok: errors.length === 0,
      errors,
      title: parsed.title,
      description: parsed.description
    };
  } catch (e) {
    const error = e as Error;
    return {
      ok: false,
      errors: [error.message],
      title: '',
      description: ''
    };
  }
}

/**
 * Archive all plans for a branch (used after commit)
 * @param branchName - Branch name
 */
export function archiveBranchPlans(branchName: string): void {
  const planPath = getPlanPath(branchName);
  if (fs.existsSync(planPath)) {
    const archived = archivePlanFile(planPath);
    if (archived) {
      console.log(`Archived PR plan: ${archived}`);
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  createYargs(process.argv)
    .scriptName('pr-plan')
    .strict()
    .usage('Usage: $0 <command>\n\nManage PR plan markdown files.')
    .command(
      'archive <planPath>',
      'Archive a PR plan file to trash directory.',
      (y) =>
        y.positional('planPath', {
          describe: 'Path to plan markdown file',
          type: 'string',
          demandOption: true,
        }),
      (args) => {
        const archived = archivePlanFile(args.planPath as string);
        if (archived) console.log(`Archived: ${archived}`);
      },
    )
    .command(
      'validate <planPath>',
      'Validate plan structure (title + PR Description section).',
      (y) =>
        y.positional('planPath', {
          describe: 'Path to plan markdown file',
          type: 'string',
          demandOption: true,
        }),
      (args) => {
        const result = validatePlan(args.planPath as string);
        if (result.ok) {
          console.log('Plan is valid');
          console.log(`Title: ${result.title}`);
          console.log(`Description length: ${result.description.length} chars`);
          return;
        }

        console.error('Plan validation failed:');
        result.errors.forEach((err) => console.error(`  - ${err}`));
        process.exit(1);
      },
    )
    .command(
      'parse <planPath>',
      'Parse and output plan title/description as JSON.',
      (y) =>
        y.positional('planPath', {
          describe: 'Path to plan markdown file',
          type: 'string',
          demandOption: true,
        }),
      (args) => {
        const content = readPlanFile(args.planPath as string);
        const parsed = parsePlanTitleAndDescription(content);
        process.stdout.write(JSON.stringify(parsed, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
      },
    )
    .command(
      'archive-branch <branchName>',
      'Archive all PR plans for a branch.',
      (y) =>
        y.positional('branchName', {
          describe: 'Branch name',
          type: 'string',
          demandOption: true,
        }),
      (args) => {
        archiveBranchPlans(args.branchName as string);
      },
    )
    .demandCommand(1, 'Provide a command.')
    .parse();
}

