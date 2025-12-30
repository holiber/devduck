#!/usr/bin/env node

/**
 * Generate implementation plan from loaded resources
 * This script analyzes task data and generates a structured implementation plan
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as plan from './plan.js';
import { createYargs, installEpipeHandler } from '@barducks/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot(): string {
  return path.resolve(__dirname, '..');
}

function extractIssueKey(input: string): string | null {
  if (input.startsWith('http')) {
    const match = input.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  const match = input.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

interface TaskData {
  description?: string;
  summary?: string;
  components?: Array<{ display?: string; id?: string }>;
  type?: { key?: string; display?: string };
  parent?: { key?: string; display?: string };
  [key: string]: unknown;
}

export function generateImplementationPlan(planDir: string, taskData: TaskData, unattended = false): string {
  const description = taskData.description || '';
  const summary = taskData.summary || '';
  const components = (taskData.components || []).map(c => c.display || c.id).join(', ');
  
  // Analyze task description to extract key information
  const isBug = taskData.type?.key === 'bug' || taskData.type?.display?.toLowerCase().includes('ошибка');
  const isFeature = taskData.type?.key === 'feature' || taskData.type?.display?.toLowerCase().includes('фича');
  
  // Return only Implementation Plan section (without Analysis and Problem Statement)
  // as those sections already exist in the plan
  let implementationPlanContent = '';
  
  // Generate specific plan based on task description in unattended mode
  if (unattended) {
    implementationPlanContent = generateUnattendedPlan(taskData, description, summary, components, isBug);
  } else {
    // Original template-based generation
    if (isBug) {
      implementationPlanContent += `### 1. Investigation\n`;
      implementationPlanContent += `- [ ] Locate the code responsible for placeholder handling in form fields\n`;
      implementationPlanContent += `- [ ] Check how placeholders are currently set (hardcoded vs dynamic)\n`;
      implementationPlanContent += `- [ ] Identify where field settings (including "Подсказка" field) are stored\n`;
      implementationPlanContent += `- [ ] Review related components: ${components || 'frontend components'}\n\n`;
      
      implementationPlanContent += `### 2. Implementation\n`;
      implementationPlanContent += `- [ ] Modify form field components to use placeholder from field settings\n`;
      implementationPlanContent += `- [ ] Implement fallback logic: use "Подсказка" value if available, otherwise use hardcoded text\n`;
      implementationPlanContent += `- [ ] Ensure placeholder is applied to both "название" and "описание" fields\n`;
      implementationPlanContent += `- [ ] Update form creation logic to read placeholder from field configuration\n\n`;
      
      implementationPlanContent += `### 3. Testing\n`;
      implementationPlanContent += `- [ ] Test with field that has "Подсказка" filled - placeholder should appear\n`;
      implementationPlanContent += `- [ ] Test with field without "Подсказка" - should show hardcoded text\n`;
      implementationPlanContent += `- [ ] Verify placeholder appears in both "название" and "описание" fields\n`;
      implementationPlanContent += `- [ ] Test form creation flow end-to-end\n\n`;
    } else {
      implementationPlanContent += `### 1. Analysis\n`;
      implementationPlanContent += `- [ ] Review task requirements and acceptance criteria\n`;
      implementationPlanContent += `- [ ] Identify affected components and modules\n`;
      implementationPlanContent += `- [ ] Check for related tickets or dependencies\n\n`;
      
      implementationPlanContent += `### 2. Design\n`;
      implementationPlanContent += `- [ ] Design solution architecture\n`;
      implementationPlanContent += `- [ ] Identify files and components to modify\n`;
      implementationPlanContent += `- [ ] Plan data flow and component interactions\n\n`;
      
      implementationPlanContent += `### 3. Implementation\n`;
      implementationPlanContent += `- [ ] Implement core functionality\n`;
      implementationPlanContent += `- [ ] Add necessary tests\n`;
      implementationPlanContent += `- [ ] Update documentation if needed\n\n`;
      
      implementationPlanContent += `### 4. Testing\n`;
      implementationPlanContent += `- [ ] Write and run unit tests\n`;
      implementationPlanContent += `- [ ] Perform integration testing\n`;
      implementationPlanContent += `- [ ] Manual testing of the feature\n\n`;
    }
  }
  
  return implementationPlanContent;
}

function generateQuestions(taskData: TaskData, unattended = false): string {
  const description = taskData.description || '';
  const components = (taskData.components || []).map(c => c.display || c.id).join(', ');
  
  const questions: string[] = [];
  
  // Check if we need more information
  if (!components || components === 'Not specified') {
    questions.push('Which specific components/modules need to be modified?');
  }
  
  if (!description || description.length < 100) {
    questions.push('Are there any additional requirements or constraints not mentioned in the description?');
  }
  
  // Check for parent task
  if (taskData.parent) {
    questions.push(`How does this relate to parent task ${taskData.parent.key || taskData.parent.display}?`);
  }
  
  let questionsContent = '';
  if (questions.length === 0) {
    questionsContent = `No critical questions identified. Ready to proceed with implementation.\n\n`;
  } else {
    if (unattended) {
      questionsContent = `_Note: The following questions can be answered later to improve the plan. The plan is ready for implementation as-is._\n\n`;
    }
    questions.forEach((q, i) => {
      questionsContent += `${i + 1}. ${q}\n`;
    });
    questionsContent += `\n`;
  }
  
  return questionsContent;
}

export function generateUnattendedPlan(taskData: TaskData, description: string, summary: string, components: string, isBug: boolean): string {
  let planContent = '';
  
  // Analyze description to extract keywords and generate specific plan
  const lowerDesc = (description + ' ' + summary).toLowerCase();
  
  // Determine potential files/areas based on components and description
  const potentialFiles: string[] = [];
  const potentialAreas: string[] = [];
  
  // Component-based file suggestions
  if (components) {
    const compList = components.split(',').map(c => c.trim());
    compList.forEach(comp => {
      if (comp.includes('frontend') || comp.includes('dashboard') || comp.includes('feature')) {
        potentialAreas.push('Frontend components');
        potentialFiles.push(`crm/frontend/services/${comp.includes('dashboard') ? 'dashboard' : comp}/**/*.{ts,tsx}`);
      }
      if (comp.includes('bff') || comp.includes('api')) {
        potentialAreas.push('Backend API');
        potentialFiles.push(`crm/frontend/services/${comp}/**/*.{ts,js}`);
      }
    });
  }
  
  // Description-based analysis
  if (lowerDesc.includes('календар') || lowerDesc.includes('calendar')) {
    potentialAreas.push('Calendar component');
    potentialFiles.push('**/calendar*.{ts,tsx}', '**/Calendar*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('попап') || lowerDesc.includes('popup') || lowerDesc.includes('модал') || lowerDesc.includes('modal')) {
    potentialAreas.push('Modal/Popup components');
    potentialFiles.push('**/modal*.{ts,tsx}', '**/popup*.{ts,tsx}', '**/Modal*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('клонирован') || lowerDesc.includes('clone')) {
    potentialAreas.push('Clone functionality');
    potentialFiles.push('**/clone*.{ts,tsx}', '**/Clone*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('справочник') || lowerDesc.includes('reference') || lowerDesc.includes('dictionary')) {
    potentialAreas.push('Reference data components');
    potentialFiles.push('**/reference*.{ts,tsx}', '**/dictionary*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('темн') || lowerDesc.includes('dark') || lowerDesc.includes('theme') || lowerDesc.includes('токен') || lowerDesc.includes('token')) {
    potentialAreas.push('Theme/styling');
    potentialFiles.push('**/theme*.{ts,tsx}', '**/styles*.{ts,tsx}', '**/tokens*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('подсказк') || lowerDesc.includes('tooltip') || lowerDesc.includes('hint')) {
    potentialAreas.push('Tooltip/Hint components');
    potentialFiles.push('**/tooltip*.{ts,tsx}', '**/hint*.{ts,tsx}', '**/Tooltip*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('форма') || lowerDesc.includes('form')) {
    potentialAreas.push('Form components');
    potentialFiles.push('**/form*.{ts,tsx}', '**/Form*.{ts,tsx}');
  }
  
  if (lowerDesc.includes('бабл') || lowerDesc.includes('bubble') || lowerDesc.includes('chip') || lowerDesc.includes('tag')) {
    potentialAreas.push('Chip/Tag/Bubble components');
    potentialFiles.push('**/chip*.{ts,tsx}', '**/tag*.{ts,tsx}', '**/bubble*.{ts,tsx}');
  }
  
  // Generate investigation plan
  planContent += `### 1. Investigation\n\n`;
  planContent += `**Areas to investigate:**\n`;
  if (potentialAreas.length > 0) {
    potentialAreas.forEach(area => {
      planContent += `- ${area}\n`;
    });
  } else {
    planContent += `- Components: ${components || 'frontend'}\n`;
  }
  planContent += `\n`;
  
  planContent += `**Files to review:**\n`;
  if (potentialFiles.length > 0) {
    potentialFiles.forEach(file => {
      planContent += `- \`${file}\`\n`;
    });
  } else {
    planContent += `- Search for components related to: ${summary}\n`;
    if (components) {
      planContent += `- Check component directories: ${components}\n`;
    }
  }
  planContent += `\n`;
  
  planContent += `**Steps:**\n`;
  planContent += `- [ ] Search codebase for keywords related to: "${summary}"\n`;
  if (components) {
    planContent += `- [ ] Review components: ${components}\n`;
  }
  planContent += `- [ ] Identify the specific component/file causing the issue\n`;
  planContent += `- [ ] Understand current implementation and data flow\n`;
  planContent += `- [ ] Check related tests to understand expected behavior\n`;
  planContent += `\n`;
  
  // Generate implementation plan
  planContent += `### 2. Implementation\n\n`;
  planContent += `**Based on the issue description, likely changes needed:**\n`;
  
  if (isBug) {
    if (lowerDesc.includes('обрез') || lowerDesc.includes('trim') || lowerDesc.includes('overflow') || lowerDesc.includes('границ') || lowerDesc.includes('boundary')) {
      planContent += `- [ ] Add text overflow handling (text-overflow: ellipsis, overflow: hidden)\n`;
      planContent += `- [ ] Ensure proper max-width constraints on container elements\n`;
      planContent += `- [ ] Add CSS classes for text truncation\n`;
    } else if (lowerDesc.includes('задержк') || lowerDesc.includes('delay') || lowerDesc.includes('медленн') || lowerDesc.includes('slow')) {
      planContent += `- [ ] Identify performance bottleneck causing delay\n`;
      planContent += `- [ ] Optimize rendering or data loading\n`;
      planContent += `- [ ] Add loading states if needed\n`;
    } else if (lowerDesc.includes('темн') || lowerDesc.includes('dark') || lowerDesc.includes('токен') || lowerDesc.includes('token')) {
      planContent += `- [ ] Review theme token usage in affected components\n`;
      planContent += `- [ ] Replace incorrect tokens with proper dark theme tokens\n`;
      planContent += `- [ ] Test in both light and dark themes\n`;
    } else {
      planContent += `- [ ] Fix the root cause identified during investigation\n`;
      planContent += `- [ ] Ensure fix aligns with expected behavior from description\n`;
    }
  } else {
    planContent += `- [ ] Implement the feature as described in requirements\n`;
    planContent += `- [ ] Follow existing code patterns in the codebase\n`;
  }
  
  planContent += `- [ ] Update related components if needed\n`;
  planContent += `- [ ] Ensure proper error handling\n`;
  planContent += `\n`;
  
  // Note: Testing section is intentionally omitted in unattended mode
  // It will be added later when working on the task
  
  return planContent;
}

async function main(): Promise<void> {
  installEpipeHandler();

  await createYargs(process.argv)
    .scriptName('plan-generate')
    .strict()
    .usage('Usage: $0 <issueKey|url> [--unattended]\n\nGenerate Implementation Plan section from loaded resources.')
    .option('unattended', {
      type: 'boolean',
      default: false,
      describe: 'Generate a more specific plan without prompting (best-effort)',
    })
    .command(
      '$0 <issue>',
      'Generate and update the plan.md sections.',
      (y) =>
        y.positional('issue', {
          type: 'string',
          describe: 'Tracker issue key or URL',
          demandOption: true,
        }),
      (args) => {
        const issueKey = extractIssueKey(args.issue as string);
        if (!issueKey) {
          console.error('Error: Invalid issue key');
          process.exit(1);
        }

        const unattended = !!(args.unattended as boolean);

        // Find existing plan
        const planDir = plan.findExistingPlan(issueKey);
        if (!planDir) {
          console.error(`Error: No plan found for ${issueKey}. Run 'tsx scripts/plan.ts ${issueKey}' first.`);
          process.exit(1);
        }

        // Load task data
        const taskPath = path.join(planDir, 'resources', 'task.json');
        if (!fs.existsSync(taskPath)) {
          console.error(`Error: Task data not found. Run 'tsx scripts/plan.ts load ${issueKey}' first.`);
          process.exit(1);
        }

        const taskData = JSON.parse(fs.readFileSync(taskPath, 'utf8')) as TaskData;

        // Generate implementation plan
        console.log(
          unattended
            ? `Generating implementation plan in unattended mode for ${issueKey}...`
            : `Generating implementation plan for ${issueKey}...`,
        );
        const implementationPlan = generateImplementationPlan(planDir, taskData, unattended);

        // Update plan section
        plan.updatePlanSection(planDir, 'Implementation Plan', implementationPlan);

        // Generate and update questions section
        const questionsContent = generateQuestions(taskData, unattended);
        plan.updatePlanSection(planDir, 'Questions for Clarification', (questionsContent || '').trim());
        if (questionsContent && !questionsContent.includes('No critical questions')) {
          plan.updatePlanStatus(planDir, 'questions_identified');
        } else {
          plan.updatePlanStatus(planDir, 'questions_answered');
        }

        // In unattended mode, always mark as plan_ready (questions are optional improvements)
        const hasQuestions = questionsContent && !questionsContent.includes('No critical questions');
        if (unattended || !hasQuestions) {
          plan.updatePlanStatus(planDir, 'plan_ready');
          console.log(
            unattended
              ? `Plan generated and marked as ready for ${issueKey} (unattended mode)`
              : `Plan generated and marked as ready for ${issueKey}`,
          );
        } else {
          plan.updatePlanStatus(planDir, 'plan_generation');
          console.log(`Plan generated for ${issueKey}. Please review questions before proceeding.`);
        }

        const result = {
          success: true,
          issueKey,
          planDir,
          status: unattended || !hasQuestions ? 'plan_ready' : 'plan_generation',
          unattended,
        };

        process.stdout.write(JSON.stringify(result, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
      },
    )
    .parseAsync();
}

// Run main function if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const error = err as { message?: string };
    console.error('Error:', error.message || 'Unknown error');
    process.exit(1);
  });
}

