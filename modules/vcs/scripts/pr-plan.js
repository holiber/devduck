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

const fs = require('fs');
const path = require('path');

/**
 * Find workspace root by looking for workspace.config.json
 */
function findWorkspaceRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const configPath = path.join(current, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    depth++;
  }

  return null;
}

/**
 * Get PR plan directory path
 */
function getPlanDir() {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Workspace root not found. Make sure you are in a devduck workspace.');
  }
  return path.join(workspaceRoot, '.cache', 'pr');
}

/**
 * Get trash directory path
 */
function getTrashDir() {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Workspace root not found. Make sure you are in a devduck workspace.');
  }
  return path.join(workspaceRoot, '.cache', 'trash');
}

/**
 * Make timestamp for filename
 */
function makeTimestampForFilename(d = new Date()) {
  return d.toISOString().replace(/:/g, '-');
}

/**
 * Archive PR plan file to trash directory
 * @param {string} planPath - Path to plan file
 * @returns {string} Path to archived file
 */
function archivePlanFile(planPath) {
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
 * @param {string} branchName - Branch name
 * @returns {string} Path to plan file
 */
function getPlanPath(branchName) {
  const planDir = getPlanDir();
  const safeBranchName = branchName.replace(/[\/\\]/g, '-');
  return path.join(planDir, `${safeBranchName}.plan.md`);
}

/**
 * Read plan file
 * @param {string} planPath - Path to plan file
 * @returns {string} Plan content
 */
function readPlanFile(planPath) {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }
  return fs.readFileSync(planPath, 'utf8');
}

/**
 * Parse plan title and description from plan content
 * @param {string} content - Plan file content
 * @returns {object} { title, description }
 */
function parsePlanTitleAndDescription(content) {
  const lines = content.split('\n');
  let title = '';
  let description = '';
  let inDescription = false;
  let descriptionLines = [];

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

/**
 * Validate plan has title and description
 * @param {string} planPath - Path to plan file
 * @returns {object} { ok, errors, title, description }
 */
function validatePlan(planPath) {
  try {
    const content = readPlanFile(planPath);
    const parsed = parsePlanTitleAndDescription(content);
    const errors = [];
    
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
    return {
      ok: false,
      errors: [e.message],
      title: '',
      description: ''
    };
  }
}

/**
 * Archive all plans for a branch (used after commit)
 * @param {string} branchName - Branch name
 */
function archiveBranchPlans(branchName) {
  const planPath = getPlanPath(branchName);
  if (fs.existsSync(planPath)) {
    const archived = archivePlanFile(planPath);
    if (archived) {
      console.log(`Archived PR plan: ${archived}`);
    }
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === 'archive') {
      const planPath = args[1];
      if (!planPath) {
        console.error('Usage: node pr-plan.js archive <plan-path>');
        process.exit(1);
      }
      const archived = archivePlanFile(planPath);
      if (archived) {
        console.log(`Archived: ${archived}`);
      }
    } else if (command === 'validate') {
      const planPath = args[1];
      if (!planPath) {
        console.error('Usage: node pr-plan.js validate <plan-path>');
        process.exit(1);
      }
      const result = validatePlan(planPath);
      if (result.ok) {
        console.log('Plan is valid');
        console.log(`Title: ${result.title}`);
        console.log(`Description length: ${result.description.length} chars`);
      } else {
        console.error('Plan validation failed:');
        result.errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
      }
    } else if (command === 'parse') {
      const planPath = args[1];
      if (!planPath) {
        console.error('Usage: node pr-plan.js parse <plan-path>');
        process.exit(1);
      }
      const content = readPlanFile(planPath);
      const parsed = parsePlanTitleAndDescription(content);
      console.log(JSON.stringify(parsed, null, 2));
    } else if (command === 'archive-branch') {
      const branchName = args[1];
      if (!branchName) {
        console.error('Usage: node pr-plan.js archive-branch <branch-name>');
        process.exit(1);
      }
      archiveBranchPlans(branchName);
    } else {
      console.error('Usage: node pr-plan.js <command> [args]');
      console.error('Commands:');
      console.error('  archive <plan-path>        - Archive plan file to trash');
      console.error('  validate <plan-path>       - Validate plan structure');
      console.error('  parse <plan-path>          - Parse and output plan title/description');
      console.error('  archive-branch <branch>    - Archive all plans for a branch');
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  findWorkspaceRoot,
  getPlanDir,
  getTrashDir,
  archivePlanFile,
  getPlanPath,
  readPlanFile,
  parsePlanTitleAndDescription,
  validatePlan,
  archiveBranchPlans
};

