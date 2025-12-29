#!/usr/bin/env node

/**
 * Plan command for working with Tracker issues
 * 
 * Creates and manages implementation plans for Tracker tasks.
 * Loads resources, generates plans, tracks execution progress.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { executeCommand } from '../../core/scripts/utils.js';
// TODO: Refactor to use issue-tracker API instead of hardcoded external module import
// This should use the issue-tracker module's provider system for better modularity
// Currently uses dynamic discovery - external modules should provide issue-tracker providers
let tracker: any = null;
async function getTracker() {
  if (tracker) return tracker;
  try {
    const { discoverProvidersFromModules, getProvider } = await import('../../../scripts/lib/provider-registry.js');
    const { resolveDevduckRoot } = await import('../../../scripts/lib/barducks-paths.js');
    const { findWorkspaceRoot } = await import('../../../scripts/lib/workspace-root.js');
    const { getWorkspaceConfigFilePath, readWorkspaceConfigFile } = await import(
      '../../../scripts/lib/workspace-config.js'
    );
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    const { devduckRoot } = resolveDevduckRoot({ cwd: process.cwd(), moduleDir: __dirname });
    await discoverProvidersFromModules({ extensionsDir: path.join(devduckRoot, 'extensions') });
    
    // Discover from external repos if workspace config exists
    if (workspaceRoot) {
      const configPath = getWorkspaceConfigFilePath(workspaceRoot);
      if (fs.existsSync(configPath)) {
        const config = readWorkspaceConfigFile<{ repos?: string[] }>(configPath);
        if (config?.repos) {
          const { loadModulesFromRepo, getDevduckVersion } = await import('../../../scripts/lib/repo-modules.js');
          const devduckVersion = getDevduckVersion();
          for (const repoUrl of config.repos) {
            try {
              const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
              if (fs.existsSync(repoModulesPath)) {
                await discoverProvidersFromModules({ extensionsDir: repoModulesPath });
              }
            } catch {
              // Skip failed repos
            }
          }
        }
      }
    }
    
    const provider = getProvider('issue-tracker');
    if (provider) {
      tracker = provider;
      return tracker;
    }
  } catch (error) {
    // Issue tracker provider not available
  }
  throw new Error('Issue tracker provider not available. Please install an issue tracker provider module.');
}
import { getEnv } from '../../core/scripts/lib/env.js';
import { createYargs, installEpipeHandler } from '../../../scripts/lib/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLAN_STAGES = [
  'initialized',
  'task_loaded',
  'resources_discovered',
  'resources_loading',
  'resources_loaded',
  'plan_generation',
  'questions_identified',
  'questions_answered',
  'plan_ready',
  'execution_started',
  'execution_in_progress',
  'execution_completed',
  'testing_prepared',
  'done'
];

function getProjectRoot() {
  return path.resolve(__dirname, '../../..');
}

function getTasksDir() {
  const root = getProjectRoot();
  const tasksDir = path.join(root, '.cache', 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });
  return tasksDir;
}

// Backward-compatible alias (deprecated): "plans" are stored under tasks dir.
function getPlansDir() {
  return getTasksDir();
}

function getTrashDir() {
  return path.join(getProjectRoot(), '.cache', 'trash');
}

/**
 * Translate title to English using cursor-agent with a cheap model.
 * Falls back to transliteration if translation fails or cursor-agent is unavailable.
 */
function translateTitleToEnglish(title) {
  const apiKey = getEnv('CURSOR_API_KEY');
  if (!apiKey) {
    return null; // No API key, use transliteration fallback
  }

  try {
    // Use cursor-agent with cheap model for translation
    const result = spawnSync(
      'cursor-agent',
      ['-p', '--force', `Translate this Russian task title to a short English phrase (max 5 words, no quotes): "${title}"`, '--model', 'composer-1'],
      {
        env: { ...process.env, CURSOR_API_KEY: apiKey },
        encoding: 'utf8',
        timeout: 10000, // 10s timeout
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    if (result.status === 0 && result.stdout) {
      const translated = result.stdout.trim().split('\n').pop().trim();
      // Remove quotes if present
      const clean = translated.replace(/^["']|["']$/g, '');
      if (clean && clean.length > 0 && clean.length < 100) {
        return clean;
      }
    }
  } catch (error) {
    // Translation failed, use transliteration fallback
  }

  return null;
}

function sanitizeFilename(str) {
  // Ensure we always produce a non-empty ASCII slug.
  // Tracker summaries may be in Russian and would otherwise collapse to empty => "CRM-12345_".
  // Prefer AI translation (via translateTitleToEnglish), fallback to transliteration.
  const raw = String(str || 'task');

  const map = new Map([
    ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'g'], ['д', 'd'], ['е', 'e'], ['ё', 'yo'], ['ж', 'zh'],
    ['з', 'z'], ['и', 'i'], ['й', 'y'], ['к', 'k'], ['л', 'l'], ['м', 'm'], ['н', 'n'], ['о', 'o'],
    ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'], ['ф', 'f'], ['х', 'kh'], ['ц', 'ts'],
    ['ч', 'ch'], ['ш', 'sh'], ['щ', 'sch'], ['ъ', ''], ['ы', 'y'], ['ь', ''], ['э', 'e'], ['ю', 'yu'], ['я', 'ya'],
  ]);

  const translit = (s) => {
    let out = '';
    for (const ch of String(s || '')) {
      const lower = ch.toLowerCase();
      if (map.has(lower)) {
        const rep = map.get(lower);
        out += rep;
      } else {
        out += ch;
      }
    }
    return out;
  };

  const slugify = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+/, '')
      .replace(/_+$/, '')
      .replace(/_+/g, '_')
      .slice(0, 50);

  const asciiFirst = slugify(raw);
  if (asciiFirst && asciiFirst !== 'task') return asciiFirst;
  return slugify(translit(raw)) || 'task';
}

function extractIssueKey(input) {
  // Extract issue key from URL or use as-is
  if (input.startsWith('http')) {
    const match = input.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  // Assume it's already a key like CRM-47926
  const match = input.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function findExistingPlan(issueKey) {
  const plansDir = getTasksDir();
  if (!fs.existsSync(plansDir)) return null;
  
  const entries = fs.readdirSync(plansDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(issueKey + '_')) {
      return path.join(plansDir, entry.name);
    }
  }
  return null;
}

function createPlanDirectory(issueKey, taskTitle, englishTitle = null) {
  const plansDir = getTasksDir();
  fs.mkdirSync(plansDir, { recursive: true });
  
  // Use English title if provided (from AI translation), otherwise use original title
  const titleToUse = englishTitle || taskTitle;
  const sanitizedTitle = sanitizeFilename(titleToUse || 'task');
  const dirName = `${issueKey}_${sanitizedTitle}`;
  const planDir = path.join(plansDir, dirName);
  
  if (fs.existsSync(planDir)) {
    throw new Error(`Plan directory already exists: ${planDir}`);
  }
  
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(path.join(planDir, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(planDir, 'temp'), { recursive: true });
  
  return planDir;
}

function loadPlanMetadata(planDir) {
  const planPath = path.join(planDir, 'plan.md');
  if (!fs.existsSync(planPath)) return null;
  
  const content = fs.readFileSync(planPath, 'utf8');
  const statusMatch = content.match(/\*\*Status\*\*:\s*(\w+)/);
  const createdMatch = content.match(/\*\*Created\*\*:\s*([^\n]+)/);
  const updatedMatch = content.match(/\*\*Last Updated\*\*:\s*([^\n]+)/);
  
  return {
    status: statusMatch ? statusMatch[1] : 'unknown',
    created: createdMatch ? createdMatch[1] : null,
    lastUpdated: updatedMatch ? updatedMatch[1] : null,
    planPath
  };
}

async function listMyTasks() {
  try {
    const trackerInstance = await getTracker();
    const issues = trackerInstance.fetchMy({ openOnly: true });
    
    if (issues.length === 0) {
      return {
        success: true,
        tasks: [],
        message: 'No open tasks assigned to you'
      };
    }
    
    const formatted = issues.map(issue => ({
      key: issue.key,
      summary: issue.summary || 'No title',
      status: issue.statusType?.display || issue.status?.display || 'Unknown',
      queue: issue.queue?.key || 'Unknown',
      url: `https://st.yandex-team.ru/${issue.key}`,
      assignee: issue.assignee?.display || 'Unassigned'
    }));
    
    return {
      success: true,
      tasks: formatted,
      count: formatted.length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      tasks: []
    };
  }
}

async function loadTaskData(issueKey) {
  try {
    const trackerInstance = await getTracker();
    const issue = trackerInstance.getIssue(issueKey, { withComments: true });
    return {
      success: true,
      issue
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

function saveTaskData(planDir, taskData) {
  const taskPath = path.join(planDir, 'resources', 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2), 'utf8');
  
  const resourcesPath = path.join(planDir, 'resources.json');
  let resources = {};
  if (fs.existsSync(resourcesPath)) {
    resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
  }
  
  resources['resources/task.json'] = {
    path: 'resources/task.json',
    indexedAt: new Date().toISOString(),
    lastUpdated: taskData.updatedAt || null,
    type: 'json',
    description: 'Main task data from Tracker API',
    size: fs.statSync(taskPath).size,
    downloaded: true,
    distance: 0,
    source: `https://st-api.yandex-team.ru/v3/issues/${taskData.key}`
  };
  
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), 'utf8');
  
  return taskPath;
}

function getTaskStatePath(taskDir) {
  return path.join(taskDir, 'task.json');
}

function readTaskState(taskDir) {
  const p = getTaskStatePath(taskDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeTaskState(taskDir, state) {
  const p = getTaskStatePath(taskDir);
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function upsertTaskStateFromTicket(taskDir, ticket) {
  const prev = readTaskState(taskDir) || {};
  const now = new Date().toISOString();

  const next = {
    id: prev.id || ticket.key,
    type: prev.type || 'tracker',
    status: prev.status || 'fetched',
    branch: prev.branch ?? null,
    'last-fetch': now,
    ticket,
    pr: prev.pr ?? null,
    estimates: prev.estimates || { sp: [], readiness: [] },
    ai_usage: prev.ai_usage || [],
    runs: prev.runs || [],
    children: prev.children || [],
  };

  writeTaskState(taskDir, next);
  return next;
}

function updatePlanStatus(planDir, status, additionalData = {}) {
  const planPath = path.join(planDir, 'plan.md');
  let content = '';
  
  if (fs.existsSync(planPath)) {
    content = fs.readFileSync(planPath, 'utf8');
  } else {
    // Create initial plan structure
    const issueKey = path.basename(planDir).split('_')[0];
    content = `# ${issueKey}: ${additionalData.title || 'Task'}\n\n`;
    content += `**Status**: ${status}\n`;
    content += `**Created**: ${new Date().toISOString()}\n`;
    content += `**Last Updated**: ${new Date().toISOString()}\n\n`;
    content += `## Work Stages\n\n`;
    PLAN_STAGES.forEach(stage => {
      content += `- [ ] ${stage}\n`;
    });
    content += `\n`;
    content += `\n## Resources\n\n`;
    content += `Total resources: 0\n`;
    content += `Downloaded: 0\n`;
    content += `Pending: 0\n\n`;
    content += `## Implementation Plan\n\n`;
    content += `[Generated by AI after resources are loaded]\n\n`;
    content += `## Questions for Clarification\n\n`;
    content += `[List of questions, if any]\n\n`;
    content += `## Execution Progress\n\n`;
    content += `[Task execution report]\n\n`;
    content += `## Testing Plan\n\n`;
    content += `[Generated after work completion]\n`;
  }
  
  // Update status
  content = content.replace(/\*\*Status\*\*:\s*\w+/g, `**Status**: ${status}`);
  content = content.replace(/\*\*Last Updated\*\*:\s*[^\n]+/g, `**Last Updated**: ${new Date().toISOString()}`);
  
  // Update stage checkboxes - rewrite the entire section to avoid formatting issues
  const currentStageIndex = PLAN_STAGES.indexOf(status);
  if (currentStageIndex >= 0) {
    // Support both English and Russian section headers for backward compatibility
    const stagesSectionStart = content.indexOf('## Work Stages') !== -1 
      ? content.indexOf('## Work Stages')
      : content.indexOf('## Этапы работы');
    if (stagesSectionStart !== -1) {
      const stagesSectionEnd = content.indexOf('\n## ', stagesSectionStart + 1);
      const beforeStages = content.substring(0, stagesSectionStart);
      const afterStages = stagesSectionEnd !== -1 ? content.substring(stagesSectionEnd) : '';
      
      let newStagesSection = '## Work Stages\n\n';
      PLAN_STAGES.forEach((stage, index) => {
        const checkbox = index <= currentStageIndex ? '[x]' : '[ ]';
        newStagesSection += `- ${checkbox} ${stage}\n`;
      });
      newStagesSection += '\n';
      
      content = beforeStages + newStagesSection + afterStages;
    }
  }
  
  fs.writeFileSync(planPath, content, 'utf8');

  // Keep task.json in sync with plan stage for convenience in dashboards.
  // This does not replace `status` (queue/executor state) — it complements it.
  try {
    const taskStatePath = path.join(planDir, 'task.json');
    if (fs.existsSync(taskStatePath)) {
      const stateRaw = fs.readFileSync(taskStatePath, 'utf8');
      const state = JSON.parse(stateRaw);
      state.stage = status;
      fs.writeFileSync(taskStatePath, JSON.stringify(state, null, 2), 'utf8');
    }
  } catch {
    // Best-effort only.
  }
}

function extractUrlsFromText(text) {
  if (!text) return [];
  
  const urls = new Set();
  
  // Markdown links: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    urls.add(match[2].trim());
  }
  
  // HTML links: <a href="url">
  const htmlLinkRegex = /<a\s+href=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlLinkRegex.exec(text)) !== null) {
    urls.add(match[1].trim());
  }
  
  // Plain URLs: http://... or https://...
  const plainUrlRegex = /https?:\/\/[^\s<>"']+/gi;
  while ((match = plainUrlRegex.exec(text)) !== null) {
    urls.add(match[0].trim());
  }
  
  return Array.from(urls);
}

function classifyResource(url) {
  // Tracker ticket: st.yandex-team.ru/{KEY}
  const ticketMatch = url.match(/st\.yandex-team\.ru\/([A-Z]+-\d+)/i);
  if (ticketMatch) {
    return {
      type: 'ticket',
      key: ticketMatch[1].toUpperCase(),
      distance: 1
    };
  }
  
  // Wiki page: wiki.yandex-team.ru/...
  if (url.includes('wiki.yandex-team.ru/')) {
    return {
      type: 'wiki',
      url: url,
      distance: 1
    };
  }
  
  // Arcadia file: a.yandex-team.ru/arcadia/...
  if (url.includes('a.yandex-team.ru/arcadia/')) {
    return {
      type: 'arcadia',
      url: url,
      distance: 1
    };
  }
  
  // Other URLs
  return {
    type: 'other',
    url: url,
    distance: 1
  };
}

async function getIssueLinks(issueKey) {
  try {
    const trackerInstance = await getTracker();
    const response = trackerInstance.request('GET', `/v3/issues/${issueKey}/links`);
    return JSON.parse(response);
  } catch (error) {
    // Links endpoint might not be available or issue might not have links
    return [];
  }
}

function discoverResources(planDir, taskData) {
  const resourcesPath = path.join(planDir, 'resources.json');
  let resources = {};
  if (fs.existsSync(resourcesPath)) {
    resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
  }
  
  const discovered = [];
  
  // Extract URLs from description
  if (taskData.description) {
    const urls = extractUrlsFromText(taskData.description);
    urls.forEach(url => {
      const resource = classifyResource(url);
      if (resource.type === 'ticket' || resource.type === 'wiki') {
        const resourceKey = resource.type === 'ticket' 
          ? `resources/${resource.key}.json`
          : `resources/${sanitizeFilename(url)}.md`;
        
        if (!resources[resourceKey]) {
          resources[resourceKey] = {
            path: resourceKey,
            indexedAt: new Date().toISOString(),
            type: resource.type,
            downloaded: false,
            distance: resource.distance,
            source: url,
            ...(resource.key && { ticketKey: resource.key })
          };
          discovered.push(resources[resourceKey]);
        }
      } else if (resource.type === 'arcadia') {
        // Store arcadia links as metadata only
        const resourceKey = `arcadia:${sanitizeFilename(url)}`;
        if (!resources[resourceKey]) {
          resources[resourceKey] = {
            path: resourceKey,
            indexedAt: new Date().toISOString(),
            type: 'arcadia',
            downloaded: false,
            distance: resource.distance,
            source: url,
            description: 'Arcadia file link (not downloaded)'
          };
          discovered.push(resources[resourceKey]);
        }
      }
    });
  }
  
  // Extract URLs from comments
  if (taskData.comments && Array.isArray(taskData.comments)) {
    taskData.comments.forEach(comment => {
      if (comment.text) {
        const urls = extractUrlsFromText(comment.text);
        urls.forEach(url => {
          const resource = classifyResource(url);
          if (resource.type === 'ticket' || resource.type === 'wiki') {
            const resourceKey = resource.type === 'ticket' 
              ? `resources/${resource.key}.json`
              : `resources/${sanitizeFilename(url)}.md`;
            
            if (!resources[resourceKey]) {
              resources[resourceKey] = {
                path: resourceKey,
                indexedAt: new Date().toISOString(),
                type: resource.type,
                downloaded: false,
                distance: resource.distance,
                source: url,
                ...(resource.key && { ticketKey: resource.key })
              };
              discovered.push(resources[resourceKey]);
            }
          }
        });
      }
    });
  }
  
  // Get links from Tracker API
  try {
    const links = getIssueLinks(taskData.key);
    if (Array.isArray(links)) {
      links.forEach(link => {
        const linkedIssue = link.issue || link;
        const issueKey = linkedIssue.key || linkedIssue;
        if (issueKey && typeof issueKey === 'string' && issueKey.match(/^[A-Z]+-\d+$/)) {
          const resourceKey = `resources/${issueKey}.json`;
          if (!resources[resourceKey]) {
            resources[resourceKey] = {
              path: resourceKey,
              indexedAt: new Date().toISOString(),
              type: 'ticket',
              downloaded: false,
              distance: 1,
              source: `https://st.yandex-team.ru/${issueKey}`,
              ticketKey: issueKey,
              relationship: link.type || link.relationship || 'linked'
            };
            discovered.push(resources[resourceKey]);
          }
        }
      });
    }
  } catch (error) {
    // Ignore errors, links might not be available
  }
  
  // Save updated resources
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), 'utf8');
  
  return {
    discovered: discovered.length,
    total: Object.keys(resources).length,
    resources
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadResourceWithRetry(planDir, resource, maxRetries = 3) {
  const delays = [1000, 2000, 4000]; // Exponential backoff
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (resource.type === 'ticket' && resource.ticketKey) {
        // Load ticket
        const trackerInstance = await getTracker();
        const issue = trackerInstance.getIssue(resource.ticketKey, { withComments: true });
        const filePath = path.join(planDir, resource.path);
        fs.writeFileSync(filePath, JSON.stringify(issue, null, 2), 'utf8');
        
        resource.downloaded = true;
        resource.indexedAt = new Date().toISOString();
        resource.size = fs.statSync(filePath).size;
        resource.lastUpdated = issue.updatedAt || null;
        
        return { success: true, resource };
      } else if (resource.type === 'wiki') {
        // Wiki loading will be done via MCP in the main flow
        // For now, mark as not downloaded if MCP is not available
        return { success: false, error: 'Wiki loading requires MCP (to be implemented)', resource };
      } else if (resource.type === 'arcadia') {
        // Arcadia files are not downloaded, just referenced
        resource.downloaded = false;
        return { success: true, resource, skipped: true };
      }
      
      return { success: false, error: 'Unknown resource type', resource };
    } catch (error) {
      if (attempt < maxRetries - 1) {
        await sleep(delays[attempt]);
        continue;
      }
      return { success: false, error: error.message, resource };
    }
  }
  
  return { success: false, error: 'Max retries exceeded', resource };
}

async function loadResources(planDir, maxDistance = 2) {
  const resourcesPath = path.join(planDir, 'resources.json');
  if (!fs.existsSync(resourcesPath)) {
    return { success: false, error: 'resources.json not found' };
  }
  
  const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
  const toLoad = [];
  
  // Find resources that need loading
  Object.values(resources).forEach(resource => {
    if (resource.distance <= maxDistance && !resource.downloaded && resource.type !== 'arcadia') {
      toLoad.push(resource);
    }
  });
  
  const results = {
    loaded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
  
  // Load resources sequentially
  for (const resource of toLoad) {
    const result = await loadResourceWithRetry(planDir, resource);
    
    if (result.success) {
      if (result.skipped) {
        results.skipped++;
      } else {
        results.loaded++;
        // Update resource in resources object
        resources[resource.path] = result.resource;
      }
    } else {
      results.failed++;
      results.errors.push({
        path: resource.path,
        error: result.error
      });
      // Mark as failed but keep in resources
      resource.downloaded = false;
      resource.error = result.error;
    }
  }
  
  // Save updated resources
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), 'utf8');
  
  // Update plan.md with resource stats
  updateResourceStats(planDir, resources, maxDistance);
  
  return {
    success: true,
    ...results,
    total: Object.keys(resources).length
  };
}

function updateResourceStats(planDir, resources, maxDistance = 2) {
  const planPath = path.join(planDir, 'plan.md');
  if (!fs.existsSync(planPath)) return;
  
  let content = fs.readFileSync(planPath, 'utf8');
  
  const total = Object.keys(resources).length;
  const downloaded = Object.values(resources).filter(r => r.downloaded).length;
  // Pending = resources that need to be loaded (distance <= maxDistance, not downloaded, not arcadia)
  const pending = Object.values(resources).filter(r => 
    r.distance <= maxDistance && !r.downloaded && r.type !== 'arcadia'
  ).length;
  
  content = content.replace(
    /Total resources:\s*\d+/g,
    `Total resources: ${total}`
  );
  content = content.replace(
    /Downloaded:\s*\d+/g,
    `Downloaded: ${downloaded}`
  );
  content = content.replace(
    /Pending:\s*\d+/g,
    `Pending: ${pending}`
  );
  
  // Also handle old Russian format for backward compatibility
  content = content.replace(
    /Всего ресурсов:\s*\d+/g,
    `Total resources: ${total}`
  );
  content = content.replace(
    /Загружено:\s*\d+/g,
    `Downloaded: ${downloaded}`
  );
  content = content.replace(
    /Ожидают загрузки:\s*\d+/g,
    `Pending: ${pending}`
  );
  
  fs.writeFileSync(planPath, content, 'utf8');
}

async function discoverLinkedResources(planDir, issueKey, currentDistance, maxDistance) {
  if (currentDistance >= maxDistance) {
    return { discovered: 0 };
  }
  
  const resourcesPath = path.join(planDir, 'resources.json');
  if (!fs.existsSync(resourcesPath)) {
    return { discovered: 0 };
  }
  
  const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
  let discovered = 0;
  
  // Find all loaded tickets at current distance
  const ticketsAtDistance = Object.values(resources).filter(
    r => r.type === 'ticket' && r.downloaded && r.distance === currentDistance
  );
  
  for (const ticketResource of ticketsAtDistance) {
    if (!ticketResource.ticketKey) continue;
    
    try {
      // Load the ticket data to get its links
      const ticketPath = path.join(planDir, ticketResource.path);
      if (!fs.existsSync(ticketPath)) continue;
      
      const ticketData = JSON.parse(fs.readFileSync(ticketPath, 'utf8'));
      
      // Get links from API
      const links = getIssueLinks(ticketResource.ticketKey);
      if (Array.isArray(links)) {
        links.forEach(link => {
          const linkedIssue = link.issue || link;
          const linkedKey = linkedIssue.key || linkedIssue;
          if (linkedKey && typeof linkedKey === 'string' && linkedKey.match(/^[A-Z]+-\d+$/)) {
            const resourceKey = `resources/${linkedKey}.json`;
            const newDistance = currentDistance + 1;
            
            // Only add if not already exists or if new distance is better
            if (!resources[resourceKey] || (resources[resourceKey].distance > newDistance && newDistance <= maxDistance)) {
              resources[resourceKey] = {
                path: resourceKey,
                indexedAt: new Date().toISOString(),
                type: 'ticket',
                downloaded: newDistance <= maxDistance ? false : true, // Don't download if distance > maxDistance
                distance: newDistance,
                source: `https://st.yandex-team.ru/${linkedKey}`,
                ticketKey: linkedKey,
                relationship: link.type || link.relationship || 'linked',
                discoveredFrom: ticketResource.ticketKey
              };
              discovered++;
            }
          }
        });
      }
    } catch (error) {
      // Ignore errors for individual tickets
    }
  }
  
  // Save updated resources
  fs.writeFileSync(resourcesPath, JSON.stringify(resources, null, 2), 'utf8');
  
  return { discovered };
}

function writeJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2));
  if (!process.stdout.isTTY) process.stdout.write('\n');
}

function validatePlan(planDir) {
  const planPath = path.join(planDir, 'plan.md');
  const resourcesPath = path.join(planDir, 'resources.json');
  
  const errors = [];
  const warnings = [];
  
  // Check if plan.md exists
  if (!fs.existsSync(planPath)) {
    errors.push('plan.md not found');
    return { valid: false, errors, warnings };
  }
  
  // Check if resources.json exists
  if (!fs.existsSync(resourcesPath)) {
    errors.push('resources.json not found');
    return { valid: false, errors, warnings };
  }
  
  const planContent = fs.readFileSync(planPath, 'utf8');
  const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
  
  // Check if plan has implementation steps (support both English and Russian)
  const hasImplPlan = planContent.includes('## Implementation Plan') || planContent.includes('## План реализации');
  const isImplPlanEmpty = planContent.match(/## (Implementation Plan|План реализации)\s*\n\s*\[(Generated by AI|Генерируется)/);
  if (!hasImplPlan || isImplPlanEmpty) {
    warnings.push('Implementation plan section is empty or not generated');
  }
  
  // Check if critical resources are loaded
  const taskResource = resources['resources/task.json'];
  if (!taskResource || !taskResource.downloaded) {
    errors.push('Main task data not loaded');
  }
  
  // Check for unanswered critical questions (support both English and Russian)
  const hasQuestions = planContent.includes('## Questions for Clarification') || planContent.includes('## Вопросы для уточнения');
  if (hasQuestions) {
    const questionsSection = planContent.match(/## (Questions for Clarification|Вопросы для уточнения)\s*\n([\s\S]*?)(?=\n## |$)/);
    if (questionsSection && questionsSection[2].trim() && 
        !questionsSection[2].includes('[List of questions') &&
        !questionsSection[2].includes('[Список вопросов') &&
        !questionsSection[2].includes('No questions') &&
        !questionsSection[2].includes('Нет вопросов')) {
      warnings.push('There are unanswered questions in the plan');
    }
  }
  
  // Check if plan is ready for execution
  const statusMatch = planContent.match(/\*\*Status\*\*:\s*(\w+)/);
  const status = statusMatch ? statusMatch[1] : 'unknown';
  
  if (status !== 'plan_ready' && status !== 'execution_started' && 
      status !== 'execution_in_progress' && status !== 'execution_completed') {
    warnings.push(`Plan status is '${status}', expected 'plan_ready' or execution stage`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    status
  };
}

async function processSingleIssue(issueKey) {
  // Check for existing plan
  const existingPlan = findExistingPlan(issueKey);
  let planDir = existingPlan;
  let shouldContinue = false;
  
  if (existingPlan) {
    const metadata = loadPlanMetadata(existingPlan);
    if (metadata) {
      // For now, we'll continue existing plan
      // In interactive mode, we would ask user
      shouldContinue = true;
      planDir = existingPlan;
    }
  }
  
  // Load task data
  const taskResult = loadTaskData(issueKey);
  if (!taskResult.success) {
    return {
      success: false,
      issueKey,
      error: taskResult.error
    };
  }
  
  const taskData = taskResult.issue;
  
  // Create plan directory if needed
  if (!planDir) {
    try {
      // Try to translate title to English using AI (cheap model), fallback to transliteration
      const englishTitle = translateTitleToEnglish(taskData.summary);
      planDir = createPlanDirectory(issueKey, taskData.summary, englishTitle);
      updatePlanStatus(planDir, 'initialized', { title: taskData.summary });
    } catch (error) {
      return {
        success: false,
        issueKey,
        error: `Error creating plan directory: ${error.message}`
      };
    }
  }
  
  // Save task data
  saveTaskData(planDir, taskData);
  upsertTaskStateFromTicket(planDir, taskData);
  updatePlanStatus(planDir, 'task_loaded');
  
  // Discover resources
  const discoveryResult = discoverResources(planDir, taskData);
  updatePlanStatus(planDir, 'resources_discovered');
  
  // Output result with next steps
  return {
    success: true,
    issueKey,
    planDir,
    task: {
      key: taskData.key,
      summary: taskData.summary,
      status: taskData.statusType?.display || 'Unknown'
    },
    planExists: shouldContinue,
    resources: {
      discovered: discoveryResult.discovered,
      total: discoveryResult.total
    },
    nextSteps: [
      'Load resources: node scripts/plan.js load <issueKey>',
      'Discover linked resources from loaded tickets (done automatically during load)',
      'Generate implementation plan (AI agent will do this)'
    ]
  };
}

async function main(argv = process.argv) {
  installEpipeHandler();

  return createYargs(argv)
    .scriptName('plan')
    .strict()
    .usage(
      [
        'Usage:',
        '  $0                              # List open tasks',
        '  $0 <issueKey|url>[,<issue...>]  # Create or continue plan(s)',
        '  $0 load <issueKey|url>          # Load resources for a plan',
        '  $0 validate <issueKey|url>      # Validate plan',
        '  $0 done <issueKey|url>          # Archive plan',
        '',
        'Examples:',
        '  $0',
        '  $0 CRM-47926',
        '  $0 https://st.yandex-team.ru/CRM-47926',
        '  $0 CRM-1,CRM-2',
        '  $0 load CRM-47926',
      ].join('\n'),
    )
    .command(
      '$0 [issue]',
      'List tasks (no args) or create/continue a plan.',
      (y) =>
        y.positional('issue', {
          type: 'string',
          describe: 'Issue key/URL or comma-separated list',
        }),
      async (args) => {
        if (!args.issue) {
          const result = listMyTasks();
          if (!result.success) {
            console.error(result.error);
            process.exit(1);
          }
          writeJson(result);
          return;
        }

        const input = String(args.issue || '');
        const issueKeys = input
          .split(',')
          .map((k) => extractIssueKey(k.trim()))
          .filter(Boolean);

        if (issueKeys.length === 0) {
          console.error('Error: Invalid issue key(s) or URL(s)');
          process.exit(2);
        }

        if (issueKeys.length > 1) {
          const results = [];
          for (const issueKey of issueKeys) {
            try {
              const result = await processSingleIssue(issueKey);
              results.push(result);
            } catch (error) {
              results.push({
                success: false,
                issueKey,
                error: error.message,
              });
            }
          }

          const output = {
            batch: true,
            total: issueKeys.length,
            successful: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
            results,
          };

          writeJson(output);
          return;
        }

        const issueKey = issueKeys[0];
        const result = await processSingleIssue(issueKey);
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        writeJson(result);
      },
    )
    .command(
      'load <issue>',
      'Load resources for a plan.',
      (y) =>
        y.positional('issue', {
          type: 'string',
          describe: 'Issue key or URL',
          demandOption: true,
        }),
      async (args) => {
        const issueKey = extractIssueKey(args.issue);
        if (!issueKey) {
          console.error('Error: Invalid issue key');
          process.exit(2);
        }

        const existingPlan = findExistingPlan(issueKey);
        if (!existingPlan) {
          console.error(`Error: No plan found for ${issueKey}`);
          process.exit(1);
        }

        // Discover linked resources first
        const resourcesPath = path.join(existingPlan, 'resources.json');
        if (fs.existsSync(resourcesPath)) {
          const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
          const taskResource = resources['resources/task.json'];
          if (taskResource && taskResource.downloaded) {
            await discoverLinkedResources(existingPlan, issueKey, 1, 2);
          }
        }

        const loadResult = await loadResources(existingPlan, 2);
        updatePlanStatus(existingPlan, 'resources_loaded');
        writeJson(loadResult);
      },
    )
    .command(
      'validate <issue>',
      'Validate plan structure.',
      (y) =>
        y.positional('issue', {
          type: 'string',
          describe: 'Issue key or URL',
          demandOption: true,
        }),
      (args) => {
        const issueKey = extractIssueKey(args.issue);
        if (!issueKey) {
          console.error('Error: Invalid issue key');
          process.exit(2);
        }

        const existingPlan = findExistingPlan(issueKey);
        if (!existingPlan) {
          console.error(`Error: No plan found for ${issueKey}`);
          process.exit(1);
        }

        const validation = validatePlan(existingPlan);
        writeJson(validation);
      },
    )
    .command(
      'done <issue>',
      'Archive a plan to trash.',
      (y) =>
        y.positional('issue', {
          type: 'string',
          describe: 'Issue key or URL',
          demandOption: true,
        }),
      (args) => {
        const issueKey = extractIssueKey(args.issue);
        if (!issueKey) {
          console.error('Error: Invalid issue key');
          process.exit(2);
        }

        const existingPlan = findExistingPlan(issueKey);
        if (!existingPlan) {
          console.error(`Error: No plan found for ${issueKey}`);
          process.exit(1);
        }

        archivePlan(existingPlan);
      },
    )
    .parseAsync();
}

function archivePlan(planDir) {
  const trashDir = getTrashDir();
  fs.mkdirSync(trashDir, { recursive: true });
  
  const planName = path.basename(planDir);
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const archiveName = `${planName}.${timestamp}`;
  const archivePath = path.join(trashDir, archiveName);
  
  // Update plan status to done before archiving
  updatePlanStatus(planDir, 'done');
  
  // Move directory to trash
  fs.renameSync(planDir, archivePath);
  
  const result = {
    success: true,
    archived: archivePath,
    message: `Plan archived to ${archivePath}`
  };
  
  process.stdout.write(JSON.stringify(result, null, 2));
  if (!process.stdout.isTTY) process.stdout.write('\n');
}

function getAllResources(planDir) {
  const resourcesPath = path.join(planDir, 'resources.json');
  if (!fs.existsSync(resourcesPath)) {
    return {};
  }
  
  const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
  const loaded = {};
  
  Object.values(resources).forEach(resource => {
    if (resource.downloaded && resource.path.startsWith('resources/')) {
      const filePath = path.join(planDir, resource.path);
      if (fs.existsSync(filePath)) {
        try {
          if (resource.type === 'ticket' || resource.type === 'json') {
            loaded[resource.path] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          } else if (resource.type === 'wiki') {
            loaded[resource.path] = fs.readFileSync(filePath, 'utf8');
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
    }
  });
  
  return loaded;
}

function updatePlanSection(planDir, sectionName, content) {
  const planPath = path.join(planDir, 'plan.md');
  if (!fs.existsSync(planPath)) {
    throw new Error('plan.md not found');
  }
  
  let planContent = fs.readFileSync(planPath, 'utf8');
  const sectionRegex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  
  const sectionHeader = `## ${sectionName}`;
  const newSection = `${sectionHeader}\n\n${content}\n\n`;
  
  if (sectionRegex.test(planContent)) {
    planContent = planContent.replace(sectionRegex, newSection);
  } else {
    // Add new section before "## Testing Plan" or at the end (support both English and Russian)
    const testPlanIndex = planContent.indexOf('## Testing Plan') !== -1 
      ? planContent.indexOf('## Testing Plan')
      : planContent.indexOf('## План тестирования');
    if (testPlanIndex !== -1) {
      planContent = planContent.slice(0, testPlanIndex) + newSection + planContent.slice(testPlanIndex);
    } else {
      planContent += '\n\n' + newSection;
    }
  }
  
  // Update last updated timestamp
  planContent = planContent.replace(/\*\*Last Updated\*\*:\s*[^\n]+/g, `**Last Updated**: ${new Date().toISOString()}`);
  
  fs.writeFileSync(planPath, planContent, 'utf8');
}

function appendExecutionLog(planDir, entry) {
  const planPath = path.join(planDir, 'plan.md');
  if (!fs.existsSync(planPath)) {
    throw new Error('plan.md not found');
  }
  
  let planContent = fs.readFileSync(planPath, 'utf8');
  const timestamp = new Date().toISOString();
  const logEntry = `\n### ${timestamp}\n\n${entry}\n\n`;
  
  // Support both English and Russian section headers
  const executionSectionRegex = /## (Execution Progress|Ход выполнения)\s*\n([\s\S]*?)(?=\n## |$)/i;
  if (executionSectionRegex.test(planContent)) {
    planContent = planContent.replace(executionSectionRegex, (match, header, content) => {
      return `## Execution Progress\n${content}${logEntry}`;
    });
  } else {
    // Add execution section
    const testPlanIndex = planContent.indexOf('## Testing Plan') !== -1 
      ? planContent.indexOf('## Testing Plan')
      : planContent.indexOf('## План тестирования');
    if (testPlanIndex !== -1) {
      planContent = planContent.slice(0, testPlanIndex) + `## Execution Progress\n\n${logEntry}` + planContent.slice(testPlanIndex);
    } else {
      planContent += `\n\n## Execution Progress\n\n${logEntry}`;
    }
  }
  
  // Update last updated timestamp
  planContent = planContent.replace(/\*\*Last Updated\*\*:\s*[^\n]+/g, `**Last Updated**: ${new Date().toISOString()}`);
  
  fs.writeFileSync(planPath, planContent, 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      await main();
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.error(err.message || String(error));
      process.exit(1);
    }
  })();
}

export {
  listMyTasks,
  loadTaskData,
  findExistingPlan,
  createPlanDirectory,
  updatePlanStatus,
  extractIssueKey,
  discoverResources,
  loadResources,
  discoverLinkedResources,
  archivePlan,
  validatePlan,
  getAllResources,
  updatePlanSection,
  appendExecutionLog,
  PLAN_STAGES
};
