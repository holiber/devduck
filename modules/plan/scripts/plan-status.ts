#!/usr/bin/env node

/**
 * Monitor status of parallel plan generation containers
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createYargs, installEpipeHandler } from '../../../scripts/lib/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function getTasksDir(): string {
  const root = getProjectRoot();
  const tasksDir = path.join(root, '.cache', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  return tasksDir;
}

function getLogFile(): string {
  return path.join(getProjectRoot(), '.cache', 'tasks-parallel.log');
}

interface ContainerInfo {
  name: string;
  issueKey: string;
  status: string;
  image: string;
}

function getRunningContainers(): ContainerInfo[] {
  const result = spawnSync('docker', [
    'ps',
    '--filter', 'name=plan-',
    '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'
  ], { encoding: 'utf8' });
  
  if (result.status !== 0) {
    return [];
  }
  
  const containers: ContainerInfo[] = [];
  const lines = result.stdout.trim().split('\n').filter(l => l.trim());
  
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const name = parts[0];
      const status = parts[1];
      const image = parts[2] || '';
      
      // Extract issue key from container name (plan-CRM_123 -> CRM-123)
      const issueKeyMatch = name.match(/plan-([A-Z]+)_(\d+)/i);
      const issueKey = issueKeyMatch 
        ? `${issueKeyMatch[1].toUpperCase()}-${issueKeyMatch[2]}`
        : name.replace('plan-', '').replace(/_/g, '-').toUpperCase();
      
      containers.push({
        name,
        issueKey,
        status,
        image
      });
    }
  }
  
  return containers;
}

interface CompletedPlan {
  issueKey: string;
  directory: string;
  status: string;
  lastUpdated: string | null;
  path: string;
}

function getCompletedPlans(): CompletedPlan[] {
  const tasksDir = getTasksDir();
  if (!fs.existsSync(tasksDir)) {
    return [];
  }
  
  const plans: CompletedPlan[] = [];
  const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const planPath = path.join(tasksDir, entry.name);
      const planMd = path.join(planPath, 'plan.md');
      
      if (fs.existsSync(planMd)) {
        const content = fs.readFileSync(planMd, 'utf8');
        const statusMatch = content.match(/\*\*Status\*\*:\s*(\w+)/);
        const updatedMatch = content.match(/\*\*Last Updated\*\*:\s*([^\n]+)/);
        const issueKeyMatch = entry.name.match(/^([A-Z]+-\d+)/);
        
        plans.push({
          issueKey: issueKeyMatch ? issueKeyMatch[1] : entry.name,
          directory: entry.name,
          status: statusMatch ? statusMatch[1] : 'unknown',
          lastUpdated: updatedMatch ? updatedMatch[1] : null,
          path: planPath
        });
      }
    }
  }
  
  return plans.sort((a, b) => {
    const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
    const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
    return dateB - dateA;
  });
}

function formatStatus() {
  installEpipeHandler();
  
  const running = getRunningContainers();
  const completed = getCompletedPlans();
  
  console.log('=== Running Plan Containers ===');
  if (running.length === 0) {
    console.log('No running containers');
  } else {
    for (const container of running) {
      console.log(`${container.issueKey}: ${container.status}`);
    }
  }
  
  console.log('\n=== Completed Plans ===');
  if (completed.length === 0) {
    console.log('No completed plans');
  } else {
    for (const plan of completed.slice(0, 10)) {
      console.log(`${plan.issueKey}: ${plan.status} (${plan.lastUpdated || 'unknown'})`);
    }
    if (completed.length > 10) {
      console.log(`... and ${completed.length - 10} more`);
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  createYargs(process.argv)
    .scriptName('plan-status')
    .strict()
    .usage('Usage: $0\n\nShow status of plan generation containers.')
    .parse();
  
  formatStatus();
}

