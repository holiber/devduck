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
const { executeCommand } = require('./utils');

let LOG_TO_STDERR = false;

function getDockerPlatform() {
  // Arc/Arcadia tooling is typically distributed for linux/amd64.
  // On Apple Silicon (darwin/arm64), Docker defaults to linux/arm64 unless overridden,
  // which often breaks installation of internal tooling packages.
  return process.env.DOCKER_PLATFORM || 'linux/amd64';
}

function getLocalImagePlatform(imageRef) {
  const result = spawnSync(
    'docker',
    ['image', 'inspect', imageRef, '--format', '{{.Os}}/{{.Architecture}}'],
    { encoding: 'utf8', stdio: 'pipe' },
  );

  if (result.status !== 0) return null;
  return (result.stdout || '').trim() || null;
}

function hasDockerBuildx() {
  const result = spawnSync('docker', ['buildx', 'version'], {
    encoding: 'utf8',
    stdio: 'ignore',
  });
  return result.status === 0;
}

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function getHostArcTokenPath() {
  const home = process.env.HOME || null;
  if (!home) return null;
  const tokenPath = path.join(home, '.arc', 'token');
  try {
    return fs.existsSync(tokenPath) ? tokenPath : null;
  } catch {
    return null;
  }
}

function getLogFile() {
  const logDir = path.join(getProjectRoot(), '.cache');
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, 'docker.log');
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(getLogFile(), logMessage);
  if (LOG_TO_STDERR) {
    console.error(message);
  } else {
    console.log(message);
  }
}

function nowMs() {
  return Date.now();
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  const rs = s - m * 60;
  return `${m}m ${rs.toFixed(1)}s`;
}

function getTasksRoot() {
  const root = getProjectRoot();
  return path.join(root, '.cache', 'tasks');
}

function findTaskDirOnHost(issueKey) {
  const tasksRoot = getTasksRoot();
  if (!fs.existsSync(tasksRoot)) return null;
  try {
    const entries = fs.readdirSync(tasksRoot, { withFileTypes: true });
    const dir = entries.find((e) => e.isDirectory() && e.name.startsWith(`${issueKey}_`));
    return dir ? path.join(tasksRoot, dir.name) : null;
  } catch {
    return null;
  }
}

function writeTaskRunLog({ issueKey, worker, success, durationMs, stdout, stderr }) {
  const taskDir = findTaskDirOnHost(issueKey);
  if (!taskDir) return null;

  const logsDir = path.join(taskDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const logPath = path.join(logsDir, `${ts}.${worker}.${success ? 'ok' : 'fail'}.log`);
  const header = [
    `issue: ${issueKey}`,
    `worker: ${worker}`,
    `success: ${success}`,
    `duration: ${formatDuration(durationMs)}`,
    `time: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  fs.writeFileSync(
    logPath,
    header + (stdout || '') + (stderr ? `\n\n[stderr]\n${stderr}` : ''),
    'utf8',
  );

  return logPath;
}

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function safeDockerNamePart(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48) || 'x';
}

function getWarmContainerName({ branch, issueKey } = {}) {
  const base = process.env.DOCKER_WARM_CONTAINER_NAME || 'devduck-arcadia-warm';
  const mode = (process.env.DOCKER_WARM_MODE || 'branch').toLowerCase();

  // Modes:
  // - single: one warm container (fastest, but cannot run different branches in parallel)
  // - branch: one warm container per branch (parallel across branches)
  // - issue: one warm container per issue key (max isolation, parallel even within same branch)
  if (mode === 'single') return base;

  if (mode === 'issue' && issueKey) {
    return `${base}-${safeDockerNamePart(issueKey)}`;
  }

  // default: branch
  return `${base}-${safeDockerNamePart(branch || 'trunk')}`;
}

function ensureDockerVolume(name) {
  const inspect = spawnSync('docker', ['volume', 'inspect', name], { encoding: 'utf8', stdio: 'ignore' });
  if (inspect.status === 0) return;
  const create = spawnSync('docker', ['volume', 'create', name], { encoding: 'utf8', stdio: 'pipe' });
  if (create.status !== 0) {
    throw new Error(`Failed to create docker volume '${name}': ${create.stderr || create.stdout || 'unknown error'}`);
  }
}

function isContainerPresent(name) {
  const res = spawnSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (res.status !== 0) return false;
  return (res.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).includes(name);
}

function isContainerRunning(name) {
  const res = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (res.status !== 0) return false;
  return (res.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).includes(name);
}

function dockerExec(name, cmd) {
  return spawnSync('docker', ['exec', name, 'bash', '-lc', cmd], { encoding: 'utf8', stdio: 'pipe' });
}

function dockerExecAsync(name, cmd, options = {}) {
  const { stdinFilePath = null } = options;
  return new Promise((resolve) => {
    const child = spawn('docker', ['exec', '-i', name, 'bash', '-lc', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    if (stdinFilePath) {
      try {
        fs.createReadStream(stdinFilePath).pipe(child.stdin);
      } catch {
        child.stdin.end();
      }
    } else {
      child.stdin.end();
    }

    child.on('close', (code) => {
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}

function ensureWarmContainerReady({ hostArcTokenPath, branch, issueKey, nameOverride }) {
  const name = nameOverride || getWarmContainerName({ branch, issueKey });
  const start = nowMs();

  // Share object-store across warm containers to speed up mounts.
  const objectStoreVol = process.env.DOCKER_ARC_OBJECT_STORE_VOLUME || 'devduck-arc-object-store';
  ensureDockerVolume(objectStoreVol);
  const projectRoot = getProjectRoot();
  const hostDotenvPath = path.join(projectRoot, '.env');

  if (!isContainerPresent(name)) {
    log(`Creating warm Arcadia container: ${name}`);

    const dockerArgs = [
      'run',
      '-d',
      '--name', name,
      '--platform', getDockerPlatform(),
      '--network', 'plan-network',
      '--cap-add', 'SYS_ADMIN',
      '--device', '/dev/fuse',
      '--security-opt', 'apparmor=unconfined',
      '-e', 'NODE_ENV=production',
      '-e', 'ARCADIA=~/arcadia',
      '-v', `${getProjectRoot()}/.cache/tasks:/workspace/.cache/tasks:rw`,
      '-v', `${objectStoreVol}:/root/.arc/object-store:rw`,
    ];

    if (hostArcTokenPath) {
      dockerArgs.push('-v', `${hostArcTokenPath}:/tmp/host-arc-token:ro`);
    }
    if (fs.existsSync(hostDotenvPath)) {
      dockerArgs.push('-v', `${hostDotenvPath}:/tmp/host-dotenv:ro`);
    }

    dockerArgs.push(
      'devduck-plan:latest',
      'bash',
      '-lc',
      [
        'set -euo pipefail',
        'mkdir -p "$HOME/.arc"',
        'if [ -f /tmp/host-arc-token ] && [ -s /tmp/host-arc-token ]; then cp /tmp/host-arc-token "$HOME/.arc/token" || true; chmod 400 "$HOME/.arc/token" 2>/dev/null || true; fi',
        'mkdir -p "$HOME/arcadia"',
        // Use dedicated store path per warm container (cannot be shared across mounts),
        // but share object-store volume across all warm containers.
        `mkdir -p "$HOME/.arc/stores/${name}"`,
        `if ! mountpoint -q "$HOME/arcadia" 2>/dev/null; then echo "Warm mount: arc mount..."; arc mount "$HOME/arcadia" --allow-other --store "$HOME/.arc/stores/${name}" --object-store "$HOME/.arc/object-store"; fi`,
        'cd "$HOME/arcadia"',
        'export PATH="$HOME/arcadia:$PATH"',
        'echo "Warm container ready. Keeping mount alive..."',
        'tail -f /dev/null',
      ].join('\n'),
    );

    const res = spawnSync('docker', dockerArgs, { encoding: 'utf8', stdio: 'pipe' });
    if (res.status !== 0) {
      throw new Error(`Failed to create warm container: ${res.stderr || res.stdout || 'unknown error'}`);
    }
  } else if (!isContainerRunning(name)) {
    log(`Starting existing warm container: ${name}`);
    const res = spawnSync('docker', ['start', name], { encoding: 'utf8', stdio: 'pipe' });
    if (res.status !== 0) {
      throw new Error(`Failed to start warm container: ${res.stderr || res.stdout || 'unknown error'}`);
    }
  }

  const waitStart = nowMs();
  while (nowMs() - waitStart < 30_000) {
    const chk = dockerExec(name, 'mountpoint -q "$HOME/arcadia" && echo OK || echo NO');
    if (chk.status === 0 && (chk.stdout || '').includes('OK')) {
      const total = nowMs() - start;
      log(`Warm container ready in ${formatDuration(total)}`);
      return { name, warmupMs: total };
    }
    sleepMs(500);
  }

  throw new Error('Warm container did not become ready in time (mountpoint not detected)');
}

const workerStatePath = path.join(getProjectRoot(), '.cache', 'tasks', '.queue', 'workers.json');

function readWorkerState() {
  try {
    if (!fs.existsSync(workerStatePath)) return { workers: {} };
    const raw = JSON.parse(fs.readFileSync(workerStatePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : { workers: {} };
  } catch {
    return { workers: {} };
  }
}

function writeWorkerState(updater) {
  const dir = path.dirname(workerStatePath);
  fs.mkdirSync(dir, { recursive: true });
  const current = readWorkerState();
  const next = updater ? updater(current) : current;
  fs.writeFileSync(workerStatePath, JSON.stringify(next, null, 2), 'utf8');
}

function setWorkerStatus(name, patch) {
  writeWorkerState((state) => {
    state.workers = state.workers || {};
    state.workers[name] = {
      ...(state.workers[name] || {}),
      ...patch,
    };
    return state;
  });
}

function markWorkersIdle(names) {
  const now = new Date().toISOString();
  writeWorkerState(() => {
    const workers = {};
    for (const n of names) {
      workers[n] = { status: 'idle', taskId: null, updatedAt: now };
    }
    return { workers };
  });
}

function ensureServiceContainer({ hostArcTokenPath }) {
  const name = 'devduck-service';
  const projectRoot = getProjectRoot();
  const hostDotenvPath = path.join(projectRoot, '.env');

  if (!isContainerPresent(name)) {
    log(`Creating service container: ${name}`);
    const dockerArgs = [
      'run',
      '-d',
      '--name', name,
      '--platform', getDockerPlatform(),
      '--network', 'plan-network',
      '--restart', 'unless-stopped',
      '-e', 'NODE_ENV=production',
      '-e', 'QUEUE_MODE=ci',
      '-v', `${projectRoot}/.cache/tasks:/workspace/.cache/tasks:rw`,
    ];

    if (hostArcTokenPath) {
      dockerArgs.push('-v', `${hostArcTokenPath}:/tmp/host-arc-token:ro`);
    }
    if (fs.existsSync(hostDotenvPath)) {
      dockerArgs.push('-v', `${hostDotenvPath}:/tmp/host-dotenv:ro`);
    }

    dockerArgs.push(
      'devduck-plan:latest',
      'bash',
      '-lc',
      [
        'set -euo pipefail',
        'cd /workspace',
        'export NVM_DIR="$HOME/.nvm"',
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true',
        'if [ -f /tmp/host-dotenv ]; then cp /tmp/host-dotenv ./.env || true; fi',
        'if [ -f /tmp/host-arc-token ] && [ -s /tmp/host-arc-token ]; then mkdir -p "$HOME/.arc"; cp /tmp/host-arc-token "$HOME/.arc/token" || true; chmod 400 "$HOME/.arc/token" 2>/dev/null || true; fi',
        'node scripts/task-queue.js',
      ].join('\n'),
    );

    const res = spawnSync('docker', dockerArgs, { encoding: 'utf8', stdio: 'pipe' });
    if (res.status !== 0) {
      throw new Error(`Failed to create service container: ${res.stderr || res.stdout || 'unknown error'}`);
    }
  } else if (!isContainerRunning(name)) {
    log(`Starting existing service container: ${name}`);
    const res = spawnSync('docker', ['start', name], { encoding: 'utf8', stdio: 'pipe' });
    if (res.status !== 0) {
      throw new Error(`Failed to start service container: ${res.stderr || res.stdout || 'unknown error'}`);
    }
  }
}

function removeMatchingContainers(filters) {
  const names = new Set();
  for (const f of filters) {
    const res = spawnSync('docker', ['ps', '-a', '--filter', f, '--format', '{{.Names}}'], { encoding: 'utf8' });
    if (res.status !== 0) continue;
    for (const n of (res.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      names.add(n);
    }
  }

  for (const name of names) {
    log(`Removing container: ${name}`);
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', stdio: 'ignore' });
  }
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

/**
 * Check if user is authenticated in registry.yandex.net
 */
function checkRegistryAuth() {
  const result = spawnSync('docker', ['info'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return false;
  }
  
  // Check if credentials exist for registry.yandex.net
  const configPath = path.join(process.env.HOME || '/root', '.docker', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.auths && config.auths['registry.yandex.net']) {
        return true;
      }
    } catch (error) {
      // Ignore parse errors
    }
  }
  
  return false;
}

/**
 * Try to pull base image from registry.yandex.net if available
 */
function tryPullBaseImage(baseImage) {
  if (!baseImage || !baseImage.includes('registry.yandex.net')) {
    return false;
  }
  
  log(`Attempting to pull base image from registry: ${baseImage}`);
  const result = spawnSync('docker', ['pull', baseImage], { 
    encoding: 'utf8',
    stdio: 'pipe'
  });
  
  if (result.status === 0) {
    log(`Successfully pulled base image: ${baseImage}`);
    return true;
  } else {
    log(`Failed to pull base image: ${baseImage} (this is OK, will use default)`);
    return false;
  }
}

function buildDockerImage(baseImage = null) {
  log('Building Docker image for plan generation...');
  const dockerfile = path.join(getProjectRoot(), 'Dockerfile.plan');
  if (!fs.existsSync(dockerfile)) {
    throw new Error(`Dockerfile.plan not found at ${dockerfile}`);
  }
  
  // Check registry authentication if using registry image
  if (baseImage && baseImage.includes('registry.yandex.net')) {
    const isAuthenticated = checkRegistryAuth();
    if (!isAuthenticated) {
      log('Warning: Not authenticated in registry.yandex.net');
      log('To authenticate:');
      log('  1. Get OAuth token from: https://oauth.yandex-team.ru/authorize?response_type=token&client_id=ff5e570368ff4c80a70c5699edffabcd9');
      log('  2. Run: docker login -u $(whoami) registry.yandex.net');
      log('  3. Enter the OAuth token as password');
      log('Falling back to default base image (ubuntu:22.04)');
      baseImage = null;
    } else {
      log('Authenticated in registry.yandex.net, attempting to use base image');
      // Try to pull base image first
      tryPullBaseImage(baseImage);
    }
  } else if (!baseImage) {
    // Check if user wants to use a registry image but hasn't specified one
    // Try common base image names (commented out as they don't exist yet)
    // Uncomment and add your base image name when available
    /*
    const commonBaseImages = [
      'registry.yandex.net/devtools/base:latest',
      'registry.yandex.net/tools/base:latest',
      'registry.yandex.net/arcadia/base:latest'
    ];
    
    const isAuthenticated = checkRegistryAuth();
    if (isAuthenticated) {
      log('Authenticated in registry.yandex.net, checking for available base images...');
      for (const img of commonBaseImages) {
        if (tryPullBaseImage(img)) {
          baseImage = img;
          log(`Found and using base image: ${img}`);
          break;
        }
      }
    }
    */
  }
  
  const platform = getDockerPlatform();
  const useBuildx = hasDockerBuildx();

  // NOTE: classic `docker build` may ignore `--platform` depending on the builder.
  // We prefer buildx to reliably build linux/amd64 images on Apple Silicon.
  const buildArgs = useBuildx
    ? ['buildx', 'build', '--load', '--platform', platform, '-f', dockerfile, '-t', 'devduck-plan:latest']
    : ['build', '-f', dockerfile, '-t', 'devduck-plan:latest'];

  if (!useBuildx && platform !== 'linux/amd64') {
    log(`Warning: docker buildx is not available; platform '${platform}' may be ignored by the classic builder`);
  } else if (useBuildx) {
    log(`Building image for platform: ${platform}`);
  }
  
  // Add build arg for base image if specified
  if (baseImage) {
    buildArgs.push('--build-arg', `BASE_IMAGE=${baseImage}`);
    log(`Using base image: ${baseImage}`);
  } else {
    log('Using default base image: ubuntu:22.04');
  }
  
  buildArgs.push(getProjectRoot());
  
  const result = spawnSync('docker', buildArgs, {
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
    '/opt/homebrew/bin/arc',  // macOS Homebrew (Apple Silicon)
    '/usr/local/bin/arc',     // macOS Homebrew (Intel) or Linux
    '/usr/bin/arc',           // System-wide installation
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
    '/opt/homebrew/bin/ya',   // macOS Homebrew (Apple Silicon)
    '/usr/local/bin/ya',      // macOS Homebrew (Intel) or Linux
    '/usr/bin/ya',            // System-wide installation
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
 * Get project path in Arcadia (relative to Arcadia root)
 * Example: "junk/alex-nazarov/devduck"
 */
function getProjectPathInArcadia() {
  const arcadiaPath = process.env.ARCADIA || path.join(process.env.HOME || '', 'arcadia');
  const expandedArcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');
  const projectRoot = getProjectRoot();
  
  // If project root is inside Arcadia, calculate relative path
  if (projectRoot.startsWith(expandedArcadiaPath)) {
    const relativePath = path.relative(expandedArcadiaPath, projectRoot);
    return relativePath.split(path.sep).join('/'); // Use forward slashes for Arcadia paths
  }
  
  // Fallback: try to detect from workspace path
  // Workspace path format: /Users/username/arcadia/junk/username/project
  const parts = projectRoot.split(path.sep);
  const arcadiaIndex = parts.findIndex(p => p === 'arcadia');
  if (arcadiaIndex >= 0 && arcadiaIndex < parts.length - 1) {
    const relativeParts = parts.slice(arcadiaIndex + 1);
    return relativeParts.join('/');
  }
  
  // Default fallback
  return 'junk/alex-nazarov/devduck';
}

/**
 * Get current branch name from host Arcadia
 */
function getHostBranch() {
  const arcadiaPath = process.env.ARCADIA || path.join(process.env.HOME || '', 'arcadia');
  const expandedArcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');
  
  // Try to get branch from arc info
  const result = executeCommand(`cd "${expandedArcadiaPath}" && arc info 2>/dev/null | grep -i "branch:" | head -1`);
  if (result.success && result.output) {
    const branchMatch = result.output.match(/branch:\s*(.+)/i);
    if (branchMatch) {
      return branchMatch[1].trim();
    }
  }
  
  // Fallback: try arc branch
  const branchResult = executeCommand(`cd "${expandedArcadiaPath}" && arc branch --list-names 2>/dev/null | grep "^*" | head -1`);
  if (branchResult.success && branchResult.output) {
    return branchResult.output.replace(/^\*\s*/, '').trim();
  }
  
  return 'trunk';
}

/**
 * Get uncommitted changes diff from host Arcadia
 */
function getHostUncommittedDiff() {
  const arcadiaPath = process.env.ARCADIA || path.join(process.env.HOME || '', 'arcadia');
  const expandedArcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');
  const projectPathInArcadia = getProjectPathInArcadia();
  const relativeArg = `--relative=/${projectPathInArcadia}`;
  
  // Check if we're in Arcadia directory (for devduck project itself)
  // If devduck is in Arcadia, we need to get diff from parent Arcadia
  const currentDir = process.cwd();
  let targetArcadiaPath = expandedArcadiaPath;
  
  // If current directory is inside Arcadia, use it
  if (currentDir.startsWith(expandedArcadiaPath)) {
    targetArcadiaPath = expandedArcadiaPath;
  }
  
  // Get diff of uncommitted changes (both staged and unstaged)
  // Use arc diff to get all uncommitted changes
  const diffResult = executeCommand(`cd "${targetArcadiaPath}" && arc diff ${relativeArg} 2>/dev/null | head -10000`);
  if (diffResult.success && diffResult.output && diffResult.output.trim() && !diffResult.output.includes('WARNING')) {
    const cleanDiff = diffResult.output.split('\n')
      .filter(line => !line.includes('WARNING'))
      .join('\n')
      .trim();
    if (cleanDiff) {
      return cleanDiff;
    }
  }
  
  // Also check for staged changes
  const diffCachedResult = executeCommand(`cd "${targetArcadiaPath}" && arc diff --cached ${relativeArg} 2>/dev/null | head -10000`);
  if (diffCachedResult.success && diffCachedResult.output && diffCachedResult.output.trim() && !diffCachedResult.output.includes('WARNING')) {
    const cleanDiff = diffCachedResult.output.split('\n')
      .filter(line => !line.includes('WARNING'))
      .join('\n')
      .trim();
    if (cleanDiff) {
      return cleanDiff;
    }
  }
  
  return null;
}

function normalizePatchFilenames(diffText) {
  // `arc diff` headers can look like:
  //   --- path/to/file\t(index)
  //   +++ path/to/file\t(working tree)
  // `patch` then treats "(index)" as part of the filename and fails.
  const lines = (diffText || '').split('\n');
  const fixed = lines.map((line) => {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const prefix = line.slice(0, 4);
      const rest = line.slice(4);
      const withoutSuffix = rest.split('\t')[0];
      return prefix + withoutSuffix;
    }
    return line;
  });

  let out = fixed.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

/**
 * Get list of uncommitted files from host Arcadia
 */
function getHostUncommittedFiles() {
  const arcadiaPath = process.env.ARCADIA || path.join(process.env.HOME || '', 'arcadia');
  const expandedArcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');
  
  // Check if we're in Arcadia directory
  const currentDir = process.cwd();
  let targetArcadiaPath = expandedArcadiaPath;
  if (currentDir.startsWith(expandedArcadiaPath)) {
    targetArcadiaPath = expandedArcadiaPath;
  }
  
  const statusResult = executeCommand(`cd "${targetArcadiaPath}" && arc status --short 2>/dev/null`);
  if (!statusResult.success || !statusResult.output) {
    return [];
  }
  
  const files = [];
  const lines = statusResult.output.split('\n').filter(l => l.trim() && !l.includes('WARNING'));
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Parse status line: " M path/to/file" or "?? path/to/file"
    const match = trimmed.match(/^([\s?AMDR])\s+(.+)$/);
    if (match) {
      const status = match[1].trim() || 'M';
      const file = match[2].trim();
      files.push({ status, file });
    }
  }
  
  return files;
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
  const reuseArcadia = process.env.DOCKER_REUSE_ARCADIA !== '0';
  const totalStart = nowMs();
  const hostDotenvPath = path.join(projectRoot, '.env');
  
  log(`Starting container: ${containerName}...`);
  
  // Get host Arcadia branch and uncommitted changes
  const hostBranch = getHostBranch();
  const hostUncommittedDiff = getHostUncommittedDiff();
  const hostUncommittedFiles = hostUncommittedDiff ? getHostUncommittedFiles() : [];
  const projectPathInArcadia = getProjectPathInArcadia();
  
  if (hostBranch && hostBranch !== 'trunk') {
    log(`Host Arcadia branch: ${hostBranch}`);
  }
  if (hostUncommittedDiff) {
    log(`Host has uncommitted changes in ${hostUncommittedFiles.length} file(s)`);
  }
  log(`Project path in Arcadia: ${projectPathInArcadia}`);
  
  // Create temporary file for uncommitted diff if needed
  let diffTempFile = null;
  if (hostUncommittedDiff) {
    const tempDir = path.join(projectRoot, '.cache', 'tmp');
    fs.mkdirSync(tempDir, { recursive: true });
    diffTempFile = path.join(tempDir, `host-diff-${Date.now()}.patch`);
    fs.writeFileSync(diffTempFile, normalizePatchFilenames(hostUncommittedDiff), 'utf8');
    log(`Created diff file: ${diffTempFile}`);
  }
  
  // Try to find arc and ya binaries on host to mount into container.
  // IMPORTANT: mounting macOS binaries into Linux containers doesn't work (Exec format error),
  // so we only attempt host mounts on Linux hosts.
  const isLinuxHost = process.platform === 'linux';
  const arcPath = isLinuxHost ? findArcBinary() : null;
  const yaPath = isLinuxHost ? findYaBinary() : null;
  const hostArcTokenPath = getHostArcTokenPath();
  
  // Fast path: reuse a warm container with Arcadia already mounted.
  // This avoids re-mounting Arcadia for every run (which is slow).
  if (reuseArcadia) {
    const warm = ensureWarmContainerReady({ hostArcTokenPath, branch: hostBranch, issueKey });
    const warmName = warm.name;

    const stepStart = nowMs();
    // Sync Arcadia inside warm container BEFORE installation (requested).
    const syncScript = `
      set -euo pipefail
      cd "$HOME/arcadia"
      export PATH="$HOME/arcadia:$PATH"
      echo "Syncing Arcadia..."
      arc checkout ${hostBranch} -f 2>/dev/null || arc checkout ${hostBranch} 2>/dev/null || true
      arc pull 2>/dev/null || true
      # Drop local changes in project subtree to guarantee patch applies cleanly
      arc checkout "${projectPathInArcadia}" 2>/dev/null || true
    `;
    const syncRes = dockerExec(warmName, syncScript);
    const syncMs = nowMs() - stepStart;
    log(`Arcadia sync: ${syncRes.status === 0 ? 'OK' : 'FAILED'} (${formatDuration(syncMs)})`);
    if (syncRes.status !== 0) {
      return { containerName: warmName, success: false, exitCode: syncRes.status, stdout: syncRes.stdout, stderr: syncRes.stderr };
    }

    // Apply host diff (already relative to projectPathInArcadia).
    let patchMs = 0;
    if (diffTempFile) {
      const patchStart = nowMs();
      const patchRes = spawnSync('docker', ['cp', diffTempFile, `${warmName}:/tmp/host-changes.patch`], { encoding: 'utf8', stdio: 'pipe' });
      if (patchRes.status === 0) {
        const applyRes = dockerExec(warmName, `
          set -e
          cd "$HOME/arcadia/${projectPathInArcadia}"
          if [ -s /tmp/host-changes.patch ]; then
            patch -p0 --batch --forward < /tmp/host-changes.patch || true
          fi
        `);
        patchMs = nowMs() - patchStart;
        log(`Host diff apply: ${applyRes.status === 0 ? 'OK' : 'WARN'} (${formatDuration(patchMs)})`);
      } else {
        patchMs = nowMs() - patchStart;
        log(`Host diff copy: FAILED (${formatDuration(patchMs)})`);
      }
    }

    // Run install.js (unless skipped) + user command (if any)
    const execStart = nowMs();
    const cmdParts = [];
    if (!skipInstall) {
      cmdParts.push('node scripts/install.js --yes || true');
    }
    if (command) {
      if (Array.isArray(command)) {
        cmdParts.push(...command);
      } else {
        cmdParts.push(command);
      }
    }
    const finalCmd = `
      set -e
      cd "$HOME/arcadia/${projectPathInArcadia}"
      export PATH="$HOME/arcadia:$PATH"
      ${cmdParts.length ? cmdParts.join('\n') : 'true'}
    `;
    const execRes = dockerExec(warmName, finalCmd);
    const execMs = nowMs() - execStart;
    const totalMs = nowMs() - totalStart;

    log(`Run finished in ${formatDuration(totalMs)} (warmup: ${formatDuration(warm.warmupMs)}, sync: ${formatDuration(syncMs)}, exec: ${formatDuration(execMs)})`);

    return {
      containerName: warmName,
      success: execRes.status === 0,
      exitCode: execRes.status,
      stdout: execRes.stdout,
      stderr: execRes.stderr,
    };
  }

  // Docker run command with FUSE support for arc mount
  // --cap-add SYS_ADMIN: Required for FUSE filesystem operations
  // --device /dev/fuse: Required for FUSE device access
  // --security-opt apparmor=unconfined: May be needed for some FUSE operations
  // Each container gets its own /arcadia directory for independent Arcadia mount
  const dockerArgs = [
    'run',
    '--rm',
    '--platform', getDockerPlatform(),
    '--name', containerName,
    '--network', 'plan-network',
    '--cap-add', 'SYS_ADMIN',
    '--device', '/dev/fuse',
    '--security-opt', 'apparmor=unconfined',
    '-e', 'NODE_ENV=production',
    '-e', 'ARCADIA=~/arcadia'
  ];
  
  // Add issue key if provided
  if (issueKey) {
    dockerArgs.push('-e', `ISSUE_KEY=${issueKey}`);
  }
  
  // Mount project files
  // Only .cache/tasks is shared between containers and host
  // All other files (.env, scripts, .cursor, package.json, etc.) come from Arcadia
  // after mounting, branch switching, and diff application
  dockerArgs.push(
    '-v', `${projectRoot}/.cache/tasks:/workspace/.cache/tasks:rw`
  );

  // Mount host .env for container-side tools that need external credentials (e.g. cursor-agent).
  // This is read-only; we copy it into project root inside the container later.
  if (fs.existsSync(hostDotenvPath)) {
    dockerArgs.push('-v', `${hostDotenvPath}:/tmp/host-dotenv:ro`);
  }

  // Provide Arc auth token to the container (read-only).
  // Without it, `arc mount` will fail with "Can't find Arc token".
  //
  // This does NOT share Arcadia working copy; it only shares the auth token file.
  // We mount it read-only to a temp path, then copy it inside the container to a writable location.
  if (hostArcTokenPath) {
    dockerArgs.push('-v', `${hostArcTokenPath}:/tmp/host-arc-token:ro`);
    log('Mounting Arc token into container (read-only, will copy inside)');
  } else {
    log('Warning: host Arc token not found at ~/.arc/token; arc mount may fail in container');
  }
  
  // Mount diff file if we have uncommitted changes
  if (diffTempFile) {
    dockerArgs.push('-v', `${diffTempFile}:/tmp/host-changes.patch:ro`);
  }
  
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
  // 1. Mount Arcadia to ~/arcadia, switch branch, apply diff
  // 2. Change to project path in Arcadia
  // 3. Run install.js from project directory (it will verify Arcadia is mounted)
  // 4. Run user-provided command(s)
  const commandParts = [];
  
  // Step 1: Mount Arcadia, switch branch, apply diff
  // Check for arc command
  let arcadiaSyncScript = `
    echo "Setting up Arcadia in container..."
    # Source nvm if available
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true

    # Ensure Arc token is available and writable inside container
    mkdir -p "$HOME/.arc"
    if [ -f /tmp/host-arc-token ] && [ -s /tmp/host-arc-token ]; then
      cp /tmp/host-arc-token "$HOME/.arc/token" || true
      chmod 400 "$HOME/.arc/token" 2>/dev/null || true
    fi
    
    # Check for arc in common locations
    ARC_CMD=""
    if command -v arc >/dev/null 2>&1; then
      ARC_CMD="arc"
    elif [ -f /usr/bin/arc ] && [ -x /usr/bin/arc ]; then
      ARC_CMD="/usr/bin/arc"
    elif [ -f /usr/local/bin/arc ] && [ -x /usr/local/bin/arc ]; then
      ARC_CMD="/usr/local/bin/arc"
    else
      # Try to find arc in PATH or common installation locations
      ARC_CMD=$(find /usr -name arc -type f -executable 2>/dev/null | head -1)
      if [ -z "$ARC_CMD" ]; then
        ARC_CMD=$(find /opt -name arc -type f -executable 2>/dev/null | head -1)
      fi
    fi
    
    if [ -z "$ARC_CMD" ]; then
      echo "ERROR: arc command not found. Cannot mount Arcadia."
      echo "Please ensure arc is installed in the Docker image or mounted from host."
      echo "Attempted locations: /usr/bin/arc, /usr/local/bin/arc, and searched in /usr and /opt"
      echo ""
      echo "To fix this:"
      echo "1. Install arc in the Docker image (Dockerfile.plan)"
      echo "2. Or mount arc binary from host (currently attempting: ${arcPath || 'not found'})"
      echo ""
      echo "Note: macOS binaries cannot run in Linux containers."
      echo "You need a Linux version of arc installed in the image."
      exit 1
    fi
    
    echo "Using arc command: $ARC_CMD"
    # Verify arc works
    if ! $ARC_CMD --version >/dev/null 2>&1; then
      echo "WARNING: arc command found but may not be executable or compatible"
      echo "Attempting to continue anyway..."
    fi
    
    # Verify FUSE configuration for --allow-other
    if ! grep -q "^user_allow_other" /etc/fuse.conf 2>/dev/null; then
      echo "WARNING: /etc/fuse.conf does not contain 'user_allow_other'"
      echo "Attempting to add it..."
      echo "user_allow_other" >> /etc/fuse.conf || {
        echo "WARNING: Could not write to /etc/fuse.conf (may need root)"
        echo "Continuing anyway - mount may fail if user_allow_other is required"
      }
    fi
    
    # Mount Arcadia to ~/arcadia (install.js expects this location)
    ARCADIA_PATH="$HOME/arcadia"
    if [ ! -d "$ARCADIA_PATH" ]; then
      mkdir -p "$ARCADIA_PATH"
    fi
    
    if ! mountpoint -q "$ARCADIA_PATH" 2>/dev/null; then
      echo "Mounting Arcadia to $ARCADIA_PATH..."
      $ARC_CMD mount "$ARCADIA_PATH" --allow-other || {
        echo "ERROR: Failed to mount Arcadia to $ARCADIA_PATH"
        echo "Troubleshooting tips:"
        echo "1. Check that FUSE is configured: grep user_allow_other /etc/fuse.conf"
        echo "2. Verify container has SYS_ADMIN capability and /dev/fuse device"
        echo "3. Check arc version: $ARC_CMD --version"
        exit 1
      }
    else
      echo "Arcadia already mounted at $ARCADIA_PATH"
    fi
    
    # Switch to Arcadia directory
    cd "$ARCADIA_PATH" || {
      echo "ERROR: Cannot access $ARCADIA_PATH"
      exit 1
    }

    # Make ya available (it comes with Arcadia tree)
    export PATH="$ARCADIA_PATH:$PATH"
  `;
  
  // Switch to same branch as host
  if (hostBranch && hostBranch !== 'trunk') {
    arcadiaSyncScript += `
    echo "Switching to host branch: ${hostBranch}"
    $ARC_CMD checkout ${hostBranch} 2>/dev/null || echo "Warning: Failed to checkout branch ${hostBranch}, staying on current branch"
    `;
  } else {
    arcadiaSyncScript += `
    echo "Host is on trunk, staying on trunk"
    `;
  }
  
  // Apply uncommitted changes from host if any
  if (diffTempFile && hostUncommittedFiles.length > 0) {
    arcadiaSyncScript += `
    # Apply uncommitted changes from host
    echo "Applying uncommitted changes from host (${hostUncommittedFiles.length} file(s))..."
    if [ -f /tmp/host-changes.patch ] && [ -s /tmp/host-changes.patch ]; then
      # Try to apply patch
      patch -p0 --batch --forward < /tmp/host-changes.patch 2>/dev/null || {
        echo "Warning: Could not apply patch automatically (this is normal for some changes)"
        echo "Uncommitted changes may not be fully synced, but committed state matches host branch"
      }
    fi
    `;
  }
  
  commandParts.push(arcadiaSyncScript);
  
  // Step 2: Change to project path in Arcadia
  commandParts.push(`
    echo "Changing to project path: ${projectPathInArcadia}"
    cd "$HOME/arcadia/${projectPathInArcadia}" || {
      echo "ERROR: Cannot access project path: $HOME/arcadia/${projectPathInArcadia}"
      exit 1
    }
    echo "Current directory: $(pwd)"
    if [ -f /tmp/host-dotenv ]; then cp /tmp/host-dotenv ./.env || true; fi
    if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
  `);
  
  // Step 3: Run install.js from project directory (if not skipped)
  // install.js will verify Arcadia is mounted (via arcadia-mounted check) and set up environment
  if (!skipInstall) {
    commandParts.push(`
      echo "Running install.js from project directory..."
      # Source nvm if available
      export NVM_DIR="$HOME/.nvm"
      [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" || true
      # Run install.js from project directory
      # It will verify Arcadia is mounted and perform other setup
      node scripts/install.js --yes || {
        # Check if install-check.json was created (indicates install.js ran)
        if [ -f .cache/install-check.json ]; then
          echo "Install.js completed with some non-critical failures (expected in container)"
        else
          echo "ERROR: install.js failed completely. Environment setup incomplete."
          exit 1
        fi
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
  
  // Clean up temporary diff file
  if (diffTempFile && fs.existsSync(diffTempFile)) {
    try {
      fs.unlinkSync(diffTempFile);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  
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
async function runParallel(issueKeys, options = {}) {
  const { json = false, verbose = false } = options;
  log(`Starting parallel plan generation for ${issueKeys.length} issue(s)`);
  
  // Check prerequisites
  checkDocker();
  checkDockerCompose();
  createNetwork();
  
  // Build image if needed
  const imageCheck = spawnSync('docker', [
    'images', '-q', 'devduck-plan:latest'
  ], { encoding: 'utf8' });

  const desiredPlatform = getDockerPlatform();
  const localImagePlatform = getLocalImagePlatform('devduck-plan:latest');
  const needsBuild =
    !imageCheck.stdout.trim() ||
    !localImagePlatform ||
    localImagePlatform !== desiredPlatform;

  if (needsBuild) {
    if (localImagePlatform && localImagePlatform !== desiredPlatform) {
      log(`Local image platform mismatch: have ${localImagePlatform}, need ${desiredPlatform}. Rebuilding...`);
    }
    // Check for base image in environment variable or use default
    const baseImage = process.env.DOCKER_BASE_IMAGE || null;
    buildDockerImage(baseImage);
  } else {
    log('Using existing Docker image');
  }
  
  // Concurrency-limited execution (default: 3 parallel workers).
  // We keep worker containers running after task completion to speed up subsequent tasks.
  const limit = Number.parseInt(process.env.DOCKER_WORKER_COUNT || process.env.DOCKER_PARALLEL_LIMIT || '2', 10);
  const parallel = Number.isFinite(limit) && limit > 0 ? limit : 2;
  const reuseArcadia = process.env.DOCKER_REUSE_ARCADIA !== '0';

  const hostBranch = getHostBranch();
  const projectPathInArcadia = getProjectPathInArcadia();
  const hostArcTokenPath = getHostArcTokenPath();
  const hostUncommittedDiff = getHostUncommittedDiff();
  let diffTempFile = null;
  if (hostUncommittedDiff) {
    const tempDir = path.join(getProjectRoot(), '.cache', 'tmp');
    fs.mkdirSync(tempDir, { recursive: true });
    diffTempFile = path.join(tempDir, `host-diff-${Date.now()}.patch`);
    fs.writeFileSync(diffTempFile, normalizePatchFilenames(hostUncommittedDiff), 'utf8');
  }

  // Create worker pool: at most N warm containers concurrently.
  const workerNames = Array.from({ length: parallel }, (_, i) => `devduck-worker-${i + 1}`);
  markWorkersIdle(workerNames);
  if (reuseArcadia) {
    for (const wn of workerNames) {
      ensureWarmContainerReady({ hostArcTokenPath, branch: hostBranch, issueKey: wn, nameOverride: wn });
    }
  }

  const startedAt = nowMs();
  const results = [];

  async function runOneOnWorker(workerName, issueKey) {
    const jobStart = nowMs();

    setWorkerStatus(workerName, { status: 'running', taskId: issueKey, startedAt: new Date().toISOString() });

    if (!reuseArcadia) {
      // Fallback to old behavior (single container per task, closes on exit)
      const containerName = sanitizeContainerName(issueKey);
      const command = [
        `node scripts/plan.js ${issueKey}`,
        `node scripts/plan.js load ${issueKey}`,
        `node scripts/plan-generate.js ${issueKey} --unattended`,
      ];
      const result = runContainer(containerName, command, { issueKey });
      setWorkerStatus(workerName, { status: 'idle', taskId: null, finishedAt: new Date().toISOString(), lastTaskId: issueKey, lastResult: result.success ? 'ok' : 'fail' });
      return { ...result, issueKey, worker: containerName, durationMs: nowMs() - jobStart };
    }

    // 1) Sync Arcadia in worker (pull latest) + force checkout host branch.
    const syncCmd = `
      set -euo pipefail
      cd "$HOME/arcadia"
      export PATH="$HOME/arcadia:$PATH"
      arc checkout ${hostBranch} -f 2>/dev/null || arc checkout ${hostBranch} 2>/dev/null || true
      arc pull 2>/dev/null || true
      arc checkout "${projectPathInArcadia}" 2>/dev/null || true
    `;
    const syncRes = await dockerExecAsync(workerName, syncCmd);
    if (syncRes.status !== 0) {
      return { issueKey, worker: workerName, success: false, exitCode: syncRes.status, stdout: syncRes.stdout, stderr: syncRes.stderr, durationMs: nowMs() - jobStart };
    }

    // 2) Apply host diff (if any) into project subtree.
    if (diffTempFile && fs.existsSync(diffTempFile)) {
      const patchCmd = `
        set -e
        cd "$HOME/arcadia/${projectPathInArcadia}"
        patch -p0 --batch --forward || true
      `;
      await dockerExecAsync(workerName, patchCmd, { stdinFilePath: diffTempFile });
    }

    // 3) Run plan pipeline (keep container alive after finish).
    const cmd = `
      set -e
      cd "$HOME/arcadia/${projectPathInArcadia}"
      export PATH="$HOME/arcadia:$PATH"
      if [ -f /tmp/host-dotenv ]; then cp /tmp/host-dotenv ./.env || true; fi
      if [ -f ./.env ]; then set -a; . ./.env; set +a; fi
      export ARCADIA="$HOME/arcadia"

      # IMPORTANT: persist plans/tasks to the host by using the shared volume.
      # In warm-worker mode we run inside Arcadia mount, so we must ensure
      # project-root ".cache/tasks" points to "/workspace/.cache/tasks".
      mkdir -p .cache
      rm -rf .cache/tasks || true
      ln -s /workspace/.cache/tasks .cache/tasks

      # Ensure task-specific branch exists for this task (inside worker).
      # Format: CRM-1234_DD_task_name
      BRANCH_NAME=$(node -e "const t=require('./scripts/tracker'); const i=t.getIssue('${issueKey}', {withComments:false}); const summary=String(i.summary||'task'); const map={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'}; const translit=(s)=>String(s||'').split('').map(ch=>map[ch.toLowerCase()]??ch).join(''); const slugify=(s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/_+/g,'_').slice(0,40)||'task'; const slug=slugify(summary)!=='task'?slugify(summary):slugify(translit(summary)); process.stdout.write('${issueKey}_DD_'+slug);")
      echo "Task branch: $BRANCH_NAME"
      arc checkout -b "$BRANCH_NAME" 2>/dev/null || arc checkout "$BRANCH_NAME" 2>/dev/null || true

      node scripts/plan.js ${issueKey}

      # Persist branch name to task.json (best-effort)
      TASK_DIR=""
      for d in ".cache/tasks/${issueKey}_"*; do
        if [ -d "$d" ]; then TASK_DIR="$d"; break; fi
      done
      if [ -n "$TASK_DIR" ] && [ -f "$TASK_DIR/task.json" ]; then
        node -e "const fs=require('fs'); const p=process.argv[1]; const b=process.argv[2]; const obj=JSON.parse(fs.readFileSync(p,'utf8')); obj.branch=b; obj['last-fetch']=new Date().toISOString(); fs.writeFileSync(p, JSON.stringify(obj,null,2));" "$TASK_DIR/task.json" "$BRANCH_NAME" || true
      fi

      node scripts/plan.js load ${issueKey}
      node scripts/plan-generate.js ${issueKey} --unattended
    `;
    const execRes = await dockerExecAsync(workerName, cmd);
    const durationMs = nowMs() - jobStart;
    setWorkerStatus(workerName, { status: 'idle', taskId: null, finishedAt: new Date().toISOString(), lastTaskId: issueKey, lastResult: execRes.status === 0 ? 'ok' : 'fail' });
    return {
      issueKey,
      worker: workerName,
      success: execRes.status === 0,
      exitCode: execRes.status,
      stdout: execRes.stdout,
      stderr: execRes.stderr,
      durationMs,
    };
  }

  let idx = 0;
  async function workerLoop(workerName) {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= issueKeys.length) return;
      const issueKey = issueKeys[current];
      log(`[${workerName}] starting ${issueKey}`);
      const r = await runOneOnWorker(workerName, issueKey);
      log(`[${workerName}] ${issueKey}: ${r.success ? 'SUCCESS' : 'FAILED'} (${formatDuration(r.durationMs)})`);
      if (r.stderr) log(`[${workerName}] ${issueKey} stderr: ${r.stderr}`);
      const logPath = writeTaskRunLog(r);
      if (logPath) log(`[${workerName}] ${issueKey} log saved: ${logPath}`);

      if (!verbose) {
        // Avoid huge JSON / console output by default in parallel mode
        r.stdout = '';
        r.stderr = r.stderr || '';
      }
      results.push(r);
    }
  }

  await Promise.all(workerNames.map(workerLoop));
  const totalMs = nowMs() - startedAt;
  log(`Parallel run completed in ${formatDuration(totalMs)} with max ${parallel} worker container(s).`);

  // Clean up temp diff file (host-side). Containers remain running by design.
  if (diffTempFile && fs.existsSync(diffTempFile)) {
    try { fs.unlinkSync(diffTempFile); } catch {}
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  log(`\nSummary: ${successful} successful, ${failed} failed out of ${issueKeys.length} total`);
  
  const summary = {
    total: issueKeys.length,
    successful,
    failed,
    results
  };

  if (json) {
    return summary;
  }

  return summary;
}

function usage(code = 0) {
  console.error(
    [
      'Usage:',
      '  node scripts/docker.js [command] [args...] [--parallel] [--dedicated] [--json] [--verbose]',
      '',
      'Commands:',
      '  <issueKey1>[,<issueKey2>,...]  Run plan generation for issue(s)',
      '  install                        Run install.js only (setup environment)',
      '  <script> [args...]             Run any script or command',
      '  service                       Ensure CI watcher service container is running',
      '  recreate                      Recreate worker + service containers (clean slate)',
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
      '',
      'Flags:',
      '  --parallel   Force parallel runner (worker pool) even for a single issue',
      '  --dedicated  Force a dedicated per-issue container (plan-<issue>) instead of warm worker reuse',
      '  --json       Print JSON summary (default when stdout is not a TTY)',
      '  --verbose    Keep full per-task stdout/stderr in JSON and console logs',
    ].join('\n')
  );
  process.exit(code);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const jsonFlag = rawArgs.includes('--json');
  const verboseFlag = rawArgs.includes('--verbose');
  const parallelFlag = rawArgs.includes('--parallel');
  const dedicatedFlag = rawArgs.includes('--dedicated');
  const args = rawArgs.filter(a => !['--json', '--verbose', '--parallel', '--dedicated'].includes(a));

  // If we are producing JSON output, keep logs on stderr to not corrupt JSON on stdout.
  if (jsonFlag || !process.stdout.isTTY) {
    LOG_TO_STDERR = true;
  }
  
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

  const desiredPlatform = getDockerPlatform();
  const localImagePlatform = getLocalImagePlatform('devduck-plan:latest');
  const needsBuild =
    !imageCheck.stdout.trim() ||
    !localImagePlatform ||
    localImagePlatform !== desiredPlatform;

  if (needsBuild) {
    if (localImagePlatform && localImagePlatform !== desiredPlatform) {
      log(`Local image platform mismatch: have ${localImagePlatform}, need ${desiredPlatform}. Rebuilding...`);
    }
    // Check for base image in environment variable or use default
    const baseImage = process.env.DOCKER_BASE_IMAGE || null;
    buildDockerImage(baseImage);
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
  const workerCountRaw = Number.parseInt(process.env.DOCKER_WORKER_COUNT || process.env.DOCKER_PARALLEL_LIMIT || '2', 10);
  const workerCount = Number.isFinite(workerCountRaw) && workerCountRaw > 0 ? workerCountRaw : 2;
  
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
  
  if (command === 'service') {
    const hostArcTokenPath = getHostArcTokenPath();
    ensureServiceContainer({ hostArcTokenPath });
    log('Service container is running.');
    return;
  }

  if (command === 'recreate') {
    const hostArcTokenPath = getHostArcTokenPath();
    const hostBranch = getHostBranch();
    const workerNames = Array.from({ length: workerCount }, (_, i) => `devduck-worker-${i + 1}`);

    removeMatchingContainers(['name=devduck-worker-', 'name=devduck-service']);

    const reuseArcadia = process.env.DOCKER_REUSE_ARCADIA !== '0';
    if (reuseArcadia) {
      for (const wn of workerNames) {
        ensureWarmContainerReady({ hostArcTokenPath, branch: hostBranch, issueKey: wn, nameOverride: wn });
      }
    }

    ensureServiceContainer({ hostArcTokenPath });
    log(`Recreated ${workerNames.length} worker container(s) and service container.`);
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
      const shouldPrintJson = jsonFlag || !process.stdout.isTTY;
      const isSingle = issueKeys.length === 1;
      const effectiveVerbose = verboseFlag || (isSingle && !parallelFlag);
      if (dedicatedFlag) {
        // Force per-issue container mode for consistent monitoring (plan-<issue>).
        process.env.DOCKER_REUSE_ARCADIA = '0';
      }
      const summary = await runParallel(issueKeys, { json: shouldPrintJson, verbose: effectiveVerbose });

      if (shouldPrintJson) {
        process.stdout.write(JSON.stringify(summary, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
      } else if (isSingle) {
        // Non-parallel UX for a single issue: show task logs in console
        const r = summary.results && summary.results[0] ? summary.results[0] : null;
        if (r && r.stdout) process.stdout.write(r.stdout);
        if (r && r.stderr) process.stderr.write(r.stderr);
      }

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
  buildDockerImage,
  getHostBranch,
  getHostUncommittedDiff,
  getHostUncommittedFiles,
  getProjectPathInArcadia,
  checkRegistryAuth,
  tryPullBaseImage,
  ensureServiceContainer,
  removeMatchingContainers,
};
