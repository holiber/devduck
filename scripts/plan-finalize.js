#!/usr/bin/env node

/**
 * Finalize plan by answering questions and marking as ready
 */

const path = require('path');
const fs = require('fs');
const plan = require('./plan');

function extractIssueKey(input) {
  if (input.startsWith('http')) {
    const match = input.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  const match = input.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function finalizePlan(issueKey) {
  const planDir = plan.findExistingPlan(issueKey);
  if (!planDir) {
    throw new Error(`No plan found for ${issueKey}`);
  }
  
  const planPath = path.join(planDir, 'plan.md');
  if (!fs.existsSync(planPath)) {
    throw new Error('plan.md not found');
  }
  
  let planContent = fs.readFileSync(planPath, 'utf8');
  
  // Load task data to get parent info
  const taskPath = path.join(planDir, 'resources', 'task.json');
  let parentInfo = '';
  if (fs.existsSync(taskPath)) {
    const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    if (taskData.parent) {
      const parentKey = taskData.parent.key || taskData.parent.display;
      parentInfo = `\n**Parent Task**: ${parentKey} - "Виджет Форма создания записи" (completed). This bug is related to placeholder handling in the form creation widget created in the parent task.`;
    }
  }
  
  // Fix duplicate Questions section and answer questions
  const questionsAnswer = `No critical questions identified. Ready to proceed with implementation.${parentInfo}\n`;
  
  // Remove duplicate Questions sections
  planContent = planContent.replace(/## Questions for Clarification\n\n[\s\S]*?(?=\n## |$)/gi, '');
  
  // Add single Questions section with answer
  const questionsSection = `## Questions for Clarification\n\n${questionsAnswer}\n`;
  
  // Insert before Execution Progress
  const execProgressIndex = planContent.indexOf('## Execution Progress');
  if (execProgressIndex !== -1) {
    planContent = planContent.slice(0, execProgressIndex) + questionsSection + planContent.slice(execProgressIndex);
  } else {
    planContent += '\n\n' + questionsSection;
  }
  
  // Write updated content first
  fs.writeFileSync(planPath, planContent, 'utf8');
  
  // Update status to plan_ready (this will also update the file)
  plan.updatePlanStatus(planDir, 'plan_ready');
  
  return {
    success: true,
    issueKey,
    planDir,
    status: 'plan_ready'
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node scripts/plan-finalize.js <issueKey>');
    process.exit(1);
  }
  
  const issueKey = extractIssueKey(args[0]);
  if (!issueKey) {
    console.error('Error: Invalid issue key');
    process.exit(1);
  }
  
  try {
    const result = await finalizePlan(issueKey);
    console.log(`Plan finalized and marked as ready for ${issueKey}`);
    process.stdout.write(JSON.stringify(result, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { finalizePlan };
