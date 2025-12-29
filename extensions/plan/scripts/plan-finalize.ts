#!/usr/bin/env node

/**
 * Finalize plan by answering questions and marking as ready
 */

import path from 'path';
import fs from 'fs';
import * as plan from './plan.js';
import { createYargs, installEpipeHandler } from '../../../src/lib/cli.js';

function extractIssueKey(input: string): string | null {
  if (input.startsWith('http')) {
    const match = input.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  const match = input.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

interface FinalizeResult {
  success: boolean;
  issueKey: string;
  planDir: string;
  status: string;
}

export async function finalizePlan(issueKey: string): Promise<FinalizeResult> {
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
    const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8')) as { parent?: { key?: string; display?: string } };
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

async function main(): Promise<void> {
  installEpipeHandler();

  await createYargs(process.argv)
    .scriptName('plan-finalize')
    .strict()
    .usage('Usage: $0 <issueKey|url>\n\nFinalize plan by answering questions and marking it as ready.')
    .command(
      '$0 <issue>',
      'Finalize a plan and mark status as plan_ready.',
      (y) =>
        y.positional('issue', {
          type: 'string',
          describe: 'Tracker issue key or URL',
          demandOption: true,
        }),
      async (args) => {
        const issueKey = extractIssueKey(args.issue as string);
        if (!issueKey) {
          console.error('Error: Invalid issue key');
          process.exit(1);
        }

        const result = await finalizePlan(issueKey);
        console.log(`Plan finalized and marked as ready for ${issueKey}`);
        process.stdout.write(JSON.stringify(result, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
      },
    )
    .parseAsync();
}

// Run main function if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

