#!/usr/bin/env node

/**
 * Docker container orchestrator
 * 
 * Runs commands in isolated Docker containers with full environment setup.
 * 
 * Each container has:
 * - Independent Arcadia mount (different branches can be active)
 * - FUSE filesystem support for arc mount
 * - Isolated environment with automatic install.js execution
 * 
 * Requirements:
 * - Docker with FUSE support (--cap-add SYS_ADMIN, --device /dev/fuse)
 * - arc and ya tools available in container (installed in image or mounted from host)
 * - Network access to Arcadia servers (may require VPN)
 */

const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getLogFile() {
  const logDir = path.join(getProjectRoot(), '.cache');
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, 'tasks-parallel.log');
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(getLogFile(), logMessage);
  console.log(message);
}

function extractIssueKey(input) {
  if (input.startsWith('http')) {
    const match = input.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  const match = input.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function sanitizeContainerName(issueKey) {
  return `plan-${issueKey.toLowerCase().replace(/-/g, '_')}`;
}

function checkDocker() {
  const result = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error('Docker is not installed or not available');
  }
  return true;
}

function checkDockerCompose() {
  // Try docker compose (v2) first
  let result = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (result.status === 0) {
    return 'docker compose';
  }
  
  // Fallback to docker-compose (v1)
  result = spawnSync('docker-compose', ['--version'], { encoding: 'utf8' });
  if (result.status === 0) {
    return 'docker-compose';
  }
  
  throw new Error('Docker Compose is not installed or not available');
}

function buildDockerImage() {
  log('Building Docker image for plan generation...');
  const dockerfile = path.join(getProjectRoot(), 'Dockerfile.plan');
  if (!fs.existsSync(dockerfile)) {
    throw new Error(`Dockerfile.plan not found at ${dockerfile}`);
  }
  
  const result = spawnSync('docker', [
    'build',
    '-f', dockerfile,
    '-t', 'devduck-plan:latest',
    getProjectRoot()
  ], {
    encoding: 'utf8',
    stdio: 'inherit'
  });
  
  if (result.status !== 0) {
    throw new Error('Failed to build Docker image');
  }
  
  log('Docker image built successfully');
}

function createContainerService(issueKey, composeFile) {
  const containerName = sanitizeContainerName(issueKey);
  const projectRoot = getProjectRoot();
  
  // Create service definition for this issue
  const serviceDef = {
    container_name: containerName,
    image: 'devduck-plan:latest',
    environment: {
      NODE_ENV: 'production',
      ISSUE_KEY: issueKey
    },
    volumes: [
      `${projectRoot}/.cache/tasks:/workspace/.cache/tasks:rw`,
      `${projectRoot}/.env:/workspace/.env:ro`,
      `${projectRoot}/scripts:/workspace/scripts:ro`,
      `${projectRoot}/.cursor:/workspace/.cursor:ro`
    ],
    working_dir: `/workspace/${issueKey}`,
    command: [
      'sh', '-c',
      `mkdir -p /workspace/${issueKey} && cd /workspace && node scripts/plan.js ${issueKey} && node scripts/plan.js load ${issueKey} && node scripts/plan-generate.js ${issueKey} --unattended`
    ],
    networks: ['plan-network'],
    restart: 'no',
    deploy: {
      resources: {
        limits: {
          cpus: '1.0',
          memory: '2G'
        },
        reservations: {
          cpus: '0.5',
          memory: '1G'
        }
      }
    }
  };
  
  return serviceDef;
}

function findArcBinary() {
  // Try to find arc binary on host system
  const possiblePaths = [
    '/usr/bin/arc',
    '/usr/local/bin/arc',
    path.join(process.env.HOME || '/root', '.local/bin/arc'),
    path.join(process.env.HOME || '/root', 'arcadia', '.ya', 'bin', 'arc')
  ];
  
  for (const arcPath of possiblePaths) {
    try {
      if (fs.existsSync(arcPath)) {
        const stats = fs.statSync(arcPath);
        if (stats.isFile() && (stats.mode & parseInt('111', 8))) {
          return arcPath;
        }
      }
    } catch (error) {
      // Continue searching
    }
  }
  
  return null;
}

function findYaBinary() {
  // Try to find ya binary on host system
  const possiblePaths = [
    '/usr/bin/ya',
    '/usr/local/bin/ya',
    path.join(process.env.HOME || '/root', '.local/bin/ya'),
    path.join(process.env.HOME || '/root', 'arcadia', '.ya', 'bin', 'ya')
  ];
  
  for (const yaPath of possiblePaths) {
    try {
      if (fs.existsSync(yaPath)) {
        const stats = fs.statSync(yaPath);
        if (stats.isFile() && (stats.mode & parseInt('111', 8))) {
          return yaPath;
        }
      }
    } catch (error) {
      // Continue searching
    }
  }
  
  return null;
}

/**
 * Run a command in Docker container with full environment setup
 * 
 * @param {string} containerName - Unique name for the container
 * @param {string|Array<string>} command - Command(s) to execute. If not provided, runs install.js only.
 *                                          Can be a single command string or array of commands.
 * @param {Object} options - Additional options
 * @param {string} options.issueKey - Issue key for environment variable (optional)
 * @param {boolean} options.skipInstall - Skip automatic install.js execution (default: false)
 * @returns {Object} Result with success, exitCode, stdout, stderr
 */
function runContainer(containerName, command = null, options = {}) {
  const projectRoot = getProjectRoot();
  const { issueKey = null, skipInstall = false } = options;
  
  log(`Starting container: ${containerName}...`);
  
  // Try to find arc and ya binaries on host to mount into container
  const arcPath = findArcBinary();
  const yaPath = findYaBinary();
  
  // Docker run command with FUSE support for arc mount
  // --cap-add SYS_ADMIN: Required for FUSE filesystem operations
  // --device /dev/fuse: Required for FUSE device access
  // --security-opt apparmor=unconfined: May be needed for some FUSE operations
  // Each container gets its own /arcadia directory for independent Arcadia mount
  const dockerArgs = [
    'run',
    '--rm',
    '--name', containerName,
    '--network', 'plan-network',
    '--cap-add', 'SYS_ADMIN',
    '--device', '/dev/fuse',
    '--security-opt', 'apparmor=unconfined',
    '-e', 'NODE_ENV=production',
    '-e', `ARCADIA=/arcadia`
  ];
  
  // Add issue key if provided
  if (issueKey) {
    dockerArgs.push('-e', `ISSUE_KEY=${issueKey}`);
  }
  
  // Mount project files
  dockerArgs.push(
    '-v', `${projectRoot}/.cache/tasks:/workspace/.cache/tasks:rw`,
    '-v', `${projectRoot}/.env:/workspace/.env:ro`,
    '-v', `${projectRoot}/scripts:/workspace/scripts:ro`,
    '-v', `${projectRoot}/.cursor:/workspace/.cursor:ro`,
    '-v', `${projectRoot}/ai.config.json:/workspace/ai.config.json:ro`,
    '-v', `${projectRoot}/package.json:/workspace/package.json:ro`,
    '-v', `${projectRoot}/package-lock.json:/workspace/package-lock.json:ro`
  );
  
  // Mount arc and ya binaries from host if found (for better compatibility)
  if (arcPath) {
    dockerArgs.push('-v', `${arcPath}:/usr/bin/arc:ro`);
    log(`Mounting arc from host: ${arcPath}`);
  }
  if (yaPath) {
    dockerArgs.push('-v', `${yaPath}:/usr/bin/ya:ro`);
    log(`Mounting ya from host: ${yaPath}`);
  }
  
  // Build command sequence
  // 1. Mount Arcadia (if not already mounted)
  // 2. Run install.js to ensure everything is set up (unless skipped)
  // 3. Run user-provided command(s)
  const commandParts = [];
  
  // Mount Arcadia
  commandParts.push(`
    if ! mountpoint -q /arcadia; then
      echo "Mounting Arcadia in container..."
      if command -v arc >/dev/null 2>&1; then
        arc mount /arcadia --allow-other || echo "Warning: Failed to mount Arcadia, continuing anyway"
      else
        echo "Warning: arc command not found, Arcadia mount skipped. Install arc in image or mount from host."
      fi
    fi
  `);
  
  // Run install.js to ensure environment is set up (unless skipped)
  if (!skipInstall) {
    commandParts.push(`
      echo "Running install.js to ensure environment is set up..."
      node scripts/install.js --yes || {
        echo "ERROR: install.js failed. Environment setup incomplete."
        exit 1
      }
    `);
  }
  
  // Run user-provided command(s)
  if (command) {
    if (Array.isArray(command)) {
      // Multiple commands - join with &&
      commandParts.push(command.join(' && '));
    } else {
      // Single command
      commandParts.push(command);
    }
  } else if (skipInstall) {
    // No command and skip install - just mount Arcadia
    log('No command provided and skipInstall=true, only mounting Arcadia');
  } else {
    // No command but install will run - that's the default behavior
    log('No command provided, running install.js only');
  }
  
  // Combine all command parts
  const fullCommand = commandParts
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0)
    .join(' && ');
  
  // Add working directory and command
  dockerArgs.push(
    '-w', '/workspace',
    'devduck-plan:latest',
    'sh', '-c',
    fullCommand
  );
  
  const result = spawnSync('docker', dockerArgs, {
    encoding: 'utf8',
    stdio: 'pipe'
  });
  
  return {
    containerName,
    success: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function createNetwork() {
  const result = spawnSync('docker', [
    'network', 'inspect', 'plan-network'
  ], { encoding: 'utf8', stdio: 'ignore' });
  
  if (result.status !== 0) {
    log('Creating Docker network plan-network...');
    spawnSync('docker', [
      'network', 'create', 'plan-network'
    ], { encoding: 'utf8', stdio: 'inherit' });
    log('Network created');
  }
}

/**
 * Run plan generation for multiple issues in parallel containers
 */
async function runParallel(issueKeys) {
  log(`Starting parallel plan generation for ${issueKeys.length} issue(s)`);
  
  // Check prerequisites
  checkDocker();
  checkDockerCompose();
  createNetwork();
  
  // Build image if needed
  const imageCheck = spawnSync('docker', [
    'images', '-q', 'devduck-plan:latest'
  ], { encoding: 'utf8' });
  
  if (!imageCheck.stdout.trim()) {
    buildDockerImage();
  } else {
    log('Using existing Docker image');
  }
  
  // Run containers in parallel
  const promises = issueKeys.map(issueKey => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const containerName = sanitizeContainerName(issueKey);
        // Run plan generation commands for this issue
        const command = [
          `node scripts/plan.js ${issueKey}`,
          `node scripts/plan.js load ${issueKey}`,
          `node scripts/plan-generate.js ${issueKey} --unattended`
        ];
        const result = runContainer(containerName, command, { issueKey });
        log(`${issueKey}: ${result.success ? 'SUCCESS' : 'FAILED'} (exit code: ${result.exitCode})`);
        if (result.stderr) {
          log(`${issueKey} stderr: ${result.stderr}`);
        }
        resolve({ ...result, issueKey });
      }, Math.random() * 1000); // Small random delay to avoid race conditions
    });
  });
  
  const results = await Promise.all(promises);
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  log(`\nSummary: ${successful} successful, ${failed} failed out of ${issueKeys.length} total`);
  
  return {
    total: issueKeys.length,
    successful,
    failed,
    results
  };
}

function usage(code = 0) {
  console.error(
    [
      'Usage:',
      '  node scripts/docker.js [command] [args...]',
      '',
      'Commands:',
      '  <issueKey1>[,<issueKey2>,...]  Run plan generation for issue(s)',
      '  install                        Run install.js only (setup environment)',
      '  <script> [args...]             Run any script or command',
      '',
      'Examples:',
      '  # Run plan generation for single issue',
      '  node scripts/docker.js CRM-123',
      '',
      '  # Run plan generation for multiple issues in parallel',
      '  node scripts/docker.js CRM-123,CRM-456,CRM-789',
      '',
      '  # Run install.js only (setup environment)',
      '  node scripts/docker.js install',
      '',
      '  # Run any script',
      '  node scripts/docker.js "node scripts/plan.js CRM-123"',
      '',
      '  # Run multiple commands',
      '  node scripts/docker.js "node scripts/plan.js CRM-123 && node scripts/plan.js load CRM-123"',
      '',
      'This script runs commands in isolated Docker containers.',
      'Each container automatically runs install.js first to ensure environment is set up.',
      'Each container has its own independent Arcadia mount.',
    ].join('\n')
  );
  process.exit(code);
}

async function main() {
  const args = process.argv.slice(2);
  
  // Show help if explicitly requested
  if (args.length > 0 && (args[0] === '--help' || args[0] === '-h')) {
    return usage(0);
  }
  
  // Check prerequisites
  checkDocker();
  checkDockerCompose();
  createNetwork();
  
  // Build image if needed
  const imageCheck = spawnSync('docker', [
    'images', '-q', 'devduck-plan:latest'
  ], { encoding: 'utf8' });
  
  if (!imageCheck.stdout.trim()) {
    buildDockerImage();
  } else {
    log('Using existing Docker image');
  }
  
  // If no arguments, run install.js only
  if (args.length === 0) {
    log('No arguments provided, running install.js in container...');
    const containerName = `devduck-install-${Date.now()}`;
    const result = runContainer(containerName, null, { skipInstall: false });
    
    log(`Install: ${result.success ? 'SUCCESS' : 'FAILED'} (exit code: ${result.exitCode})`);
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
    
    process.exit(result.success ? 0 : 1);
    return;
  }
  
  const command = args[0];
  
  // Handle "install" command - run install.js only
  if (command === 'install') {
    log('Running install.js in container...');
    const containerName = `devduck-install-${Date.now()}`;
    const result = runContainer(containerName, null, { skipInstall: false });
    
    log(`Install: ${result.success ? 'SUCCESS' : 'FAILED'} (exit code: ${result.exitCode})`);
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }
    
    process.exit(result.success ? 0 : 1);
    return;
  }
  
  // Check if it looks like issue key(s) - comma-separated issue keys
  if (command.includes(',') || /^[A-Z]+-\d+$/i.test(command)) {
  // Parse issue keys
    const issueKeys = command.split(',')
    .map(k => extractIssueKey(k.trim()))
    .filter(Boolean);
  
  if (issueKeys.length === 0) {
    console.error('Error: No valid issue keys found');
    return usage(2);
  }
  
  try {
    const summary = await runParallel(issueKeys);
    
    // Output JSON summary
    process.stdout.write(JSON.stringify(summary, null, 2));
    if (!process.stdout.isTTY) process.stdout.write('\n');
    
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    log(`Error: ${error.message}`);
    console.error(error.message);
    process.exit(1);
  }
    return;
  }
  
  // Otherwise, treat as custom command
  log(`Running custom command in container: ${args.join(' ')}`);
  const containerName = `devduck-cmd-${Date.now()}`;
  const customCommand = args.join(' ');
  const result = runContainer(containerName, customCommand);
  
  log(`Command: ${result.success ? 'SUCCESS' : 'FAILED'} (exit code: ${result.exitCode})`);
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
  
  process.exit(result.success ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    log(`Unexpected error: ${err.message}`);
    console.error('Unexpected error:', err.message);
    process.exit(1);
  });
}

module.exports = { 
  runParallel, 
  extractIssueKey, 
  runContainer,
  sanitizeContainerName,
  checkDocker,
  checkDockerCompose,
  createNetwork,
  buildDockerImage
};
