#!/usr/bin/env node

/**
 * Monitor status of parallel plan generation containers
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createYargs, installEpipeHandler } = require('../../../scripts/lib/cli');

function getProjectRoot() {
  return path.resolve(__dirname, '../../..');
}

function getTasksDir() {
  const root = getProjectRoot();
  const tasksDir = path.join(root, '.cache', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  return tasksDir;
}

function getLogFile() {
  return path.join(getProjectRoot(), '.cache', 'tasks-parallel.log');
}

function getRunningContainers() {
  const result = spawnSync('docker', [
    'ps',
    '--filter', 'name=plan-',
    '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'
  ], { encoding: 'utf8' });
  
  if (result.status !== 0) {
    return [];
  }
  
  const containers = [];
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

function getCompletedPlans() {
  const tasksDir = getTasksDir();
  if (!fs.existsSync(tasksDir)) {
    return [];
  }
  
  const plans = [];
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
    const dateA = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0);
    const dateB = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0);
    return dateB - dateA;
  });
}

function getRecentLogs(lines = 50) {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) {
    return [];
  }
  
  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.split('\n').filter(l => l.trim());
  return allLines.slice(-lines);
}

function formatTable(data, columns) {
  if (data.length === 0) {
    return 'No data';
  }
  
  // Calculate column widths
  const widths = columns.map(col => {
    const headerWidth = col.header.length;
    const dataWidth = Math.max(...data.map(row => String(row[col.key] || '').length));
    return Math.max(headerWidth, dataWidth, col.minWidth || 0);
  });
  
  // Build header
  const header = columns.map((col, i) => {
    return col.header.padEnd(widths[i]);
  }).join(' | ');
  
  const separator = columns.map((_, i) => {
    return '-'.repeat(widths[i]);
  }).join('-|-');
  
  // Build rows
  const rows = data.map(row => {
    return columns.map((col, i) => {
      const value = String(row[col.key] || '').substring(0, widths[i]);
      return value.padEnd(widths[i]);
    }).join(' | ');
  });
  
  return [header, separator, ...rows].join('\n');
}

function displayStatus(format = 'table') {
  const running = getRunningContainers();
  const completed = getCompletedPlans();
  const recentLogs = getRecentLogs(20);
  
  if (format === 'json') {
    const output = {
      running: running.length,
      completed: completed.length,
      containers: running,
      plans: completed,
      recentLogs
    };
    try {
      const jsonOutput = JSON.stringify(output, null, 2);
      process.stdout.write(jsonOutput);
      if (!process.stdout.isTTY) process.stdout.write('\n');
    } catch (error) {
      // Ignore EPIPE errors (e.g., when piped to head)
      if (error.code !== 'EPIPE') {
        throw error;
      }
    }
    return;
  }
  
  // Table format
  try {
    console.log('\n=== Running Containers ===');
    if (running.length === 0) {
      console.log('No containers currently running\n');
    } else {
      const containerTable = formatTable(running, [
        { key: 'issueKey', header: 'Issue Key', minWidth: 12 },
        { key: 'name', header: 'Container Name', minWidth: 20 },
        { key: 'status', header: 'Status', minWidth: 30 }
      ]);
      console.log(containerTable);
      console.log();
    }
    
    console.log('=== Recent Plans ===');
    if (completed.length === 0) {
      console.log('No plans found\n');
    } else {
      const recentPlans = completed.slice(0, 10);
      const plansTable = formatTable(recentPlans, [
        { key: 'issueKey', header: 'Issue Key', minWidth: 12 },
        { key: 'status', header: 'Status', minWidth: 20 },
        { key: 'lastUpdated', header: 'Last Updated', minWidth: 25 }
      ]);
      console.log(plansTable);
      console.log();
    }
    
    if (recentLogs.length > 0) {
      console.log('=== Recent Logs ===');
      recentLogs.forEach(line => {
        try {
          console.log(line);
        } catch (error) {
          // Ignore EPIPE errors (e.g., when piped to head)
          if (error.code !== 'EPIPE') {
            throw error;
          }
        }
      });
      console.log();
    }
  } catch (error) {
    // Ignore EPIPE errors (e.g., when piped to head)
    if (error.code !== 'EPIPE') {
      throw error;
    }
  }
}

function usage(code = 0) {
  console.error(
    [
      'Usage:',
      '  node scripts/plan-status.js [--format json|table]',
      '',
      'Options:',
      '  --format json    Output in JSON format',
      '  --format table   Output in table format (default)',
      '',
      'Shows status of running containers and completed plans.',
    ].join('\n')
  );
  process.exit(code);
}

function main() {
  installEpipeHandler();

  createYargs(process.argv)
    .scriptName('plan-status')
    .strict()
    .usage('Usage: $0 [--format json|table]\n\nShows status of running containers and completed plans.')
    .option('format', {
      type: 'string',
      choices: ['json', 'table'],
      default: 'table',
      describe: 'Output format',
    })
    .command(
      '$0',
      'Display plan status.',
      (y) => y,
      (args) => {
        try {
          displayStatus(args.format);
        } catch (error) {
          if (error && error.code === 'EPIPE') process.exit(0);
          console.error('Error:', error.message);
          process.exit(1);
        }
      },
    )
    .parse();
}

if (require.main === module) {
  main();
}

module.exports = { getRunningContainers, getCompletedPlans, displayStatus };
