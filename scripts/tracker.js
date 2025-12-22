#!/usr/bin/env node

/**
 * Minimal Tracker API helper.
 *
 * Goal: avoid exposing tokens in chat/logs by using curl and env vars.
 *
 * Required env:
 * - TRACKER_TOKEN: OAuth token for st-api / tracker API
 *
 * Optional env:
 * - TRACKER_API_BASE: base URL, default: https://st-api.yandex-team.ru
 *
 * Usage:
 *   node scripts/tracker.js request GET /v3/myself
 *   node scripts/tracker.js request GET /v3/issues/CRM-47926
 *
 * Notes:
 * - This script never prints the token.
 * - If you pass a JSON body, provide it as the 4th argument.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getEnv } = require('./lib/env');

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function usage(code = 1) {
  console.error(
    [
      'Usage:',
      '  node scripts/tracker.js request <METHOD> <PATH> [JSON_BODY]',
      '  node scripts/tracker.js fetchMy [options]',
      '  node scripts/tracker.js get <ISSUE_KEY> [options]',
      '',
      'Examples:',
      '  node scripts/tracker.js request GET /v3/myself',
      '  node scripts/tracker.js request GET /v3/issues/CRM-47926',
      '  node scripts/tracker.js request POST /v3/issues/_search \'{"queue":["CRM"],"assignee":"alex-nazarov","statusType":"open"}\'',
      '  node scripts/tracker.js fetchMy',
      '  node scripts/tracker.js fetchMy --open-only',
      '  node scripts/tracker.js get CRM-47926',
      '  node scripts/tracker.js get CRM-47926 --with-comments',
      '  node scripts/tracker.js get CRM-47926 --format markdown',
      '  node scripts/tracker.js get CRM-47926 --with-comments --format markdown',
      '',
      'Options for fetchMy:',
      '  --open-only    Show only open tasks (exclude done/closed)',
      '',
      'Options for get:',
      '  --with-comments    Include comments in the response',
      '  --format markdown   Format output as markdown (works with or without --with-comments)',
    ].join('\n')
  );
  process.exit(code);
}

function request(method, apiPath, bodyJsonString) {
  const token = getEnv('TRACKER_TOKEN', { envPath: path.join(getProjectRoot(), '.env') });
  if (!token) {
    throw new Error('Missing TRACKER_TOKEN in environment.');
  }

  const base = getEnv('TRACKER_API_BASE', { envPath: path.join(getProjectRoot(), '.env') }) || 'https://st-api.yandex-team.ru';
  const url = apiPath.startsWith('http') ? apiPath : `${base}${apiPath.startsWith('/') ? '' : '/'}${apiPath}`;

  const args = [
    '--fail-with-body',
    '--silent',
    '--show-error',
    '--request',
    method,
    url,
    '--header',
    `Authorization: OAuth ${token}`,
  ];

  if (bodyJsonString !== undefined && bodyJsonString !== null) {
    args.push('--header', 'Content-Type: application/json');
    args.push('--data', bodyJsonString);
  }

  const res = spawnSync('curl', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    // Do not echo curl args to avoid any chance of token exposure.
    const stderr = (res.stderr || '').trim();
    const stdout = (res.stdout || '').trim();
    const msg = stderr || stdout || `curl exited with ${res.status}`;
    const err = new Error(msg);
    err.exitCode = res.status;
    throw err;
  }

  return (res.stdout || '').trim();
}

/**
 * Get current user login from Tracker API
 */
function getMyLogin() {
  try {
    const response = request('GET', '/v3/myself');
    const user = JSON.parse(response);
    return user.login;
  } catch (e) {
    throw new Error(`Failed to get user login: ${e.message}`);
  }
}

/**
 * Fetch tasks assigned to current user
 * @param {Object} options - Options for fetching tasks
 * @param {boolean} options.openOnly - If true, filter only open tasks
 * @returns {Array} Array of issues
 */
function fetchMy(options = {}) {
  const login = getMyLogin();
  
  const filter = { assignee: login };
  // Note: statusType in filter causes 422 error, so we filter client-side
  
  const body = JSON.stringify({ filter });
  const response = request('POST', '/v3/issues/_search', body);
  const issues = JSON.parse(response);
  
  // Filter out done/closed tasks if openOnly is true
  if (options.openOnly) {
    return issues.filter(issue => {
      const statusKey = issue.statusType?.key || issue.status?.key || '';
      return statusKey !== 'done' && statusKey !== 'closed';
    });
  }
  
  return issues;
}

/**
 * Get comments for an issue
 * @param {string} issueKey - Issue key (e.g., 'CRM-47926')
 * @returns {Array} Array of comments
 */
function getIssueComments(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') {
    throw new Error('Issue key is required and must be a string');
  }
  
  try {
    const response = request('GET', `/v3/issues/${issueKey}/comments`);
    return JSON.parse(response);
  } catch (e) {
    throw new Error(`Failed to get comments for issue ${issueKey}: ${e.message}`);
  }
}

/**
 * Format issue as markdown
 * @param {Object} issue - Issue object
 * @returns {string} Markdown formatted string
 */
function formatIssueAsMarkdown(issue) {
  const lines = [];
  
  // Header
  lines.push(`# ${issue.key}: ${issue.summary || 'Без названия'}`);
  lines.push('');
  
  // Issue information table
  lines.push('## Информация о задаче');
  lines.push('');
  lines.push('| Поле | Значение |');
  lines.push('|------|----------|');
  lines.push(`| **Ключ** | ${issue.key} |`);
  lines.push(`| **Очередь** | ${issue.queue?.display || issue.queue?.key || 'N/A'} |`);
  lines.push(`| **Статус** | ${issue.statusType?.display || issue.status?.display || 'N/A'} |`);
  lines.push(`| **Тип** | ${issue.type?.display || 'N/A'} |`);
  lines.push(`| **Приоритет** | ${issue.priority?.display || 'N/A'} |`);
  lines.push(`| **Исполнитель** | ${issue.assignee?.display || 'Не назначен'} |`);
  
  if (issue.createdAt) {
    const createdDate = new Date(issue.createdAt);
    lines.push(`| **Создана** | ${createdDate.toLocaleString('ru-RU')} |`);
  }
  
  if (issue.updatedAt) {
    const updatedDate = new Date(issue.updatedAt);
    lines.push(`| **Обновлена** | ${updatedDate.toLocaleString('ru-RU')} |`);
  }
  
  lines.push('');
  
  // Description
  if (issue.description) {
    lines.push('## Описание');
    lines.push('');
    lines.push(issue.description);
    lines.push('');
  }
  
  // Comments
  if (issue.comments && issue.comments.length > 0) {
    lines.push(`## Комментарии (${issue.comments.length})`);
    lines.push('');
    
    issue.comments.forEach((comment, index) => {
      const date = comment.createdAt ? new Date(comment.createdAt).toLocaleString('ru-RU') : 'N/A';
      const author = comment.createdBy?.display || comment.author?.display || 'Неизвестно';
      
      lines.push(`### Комментарий #${index + 1} от ${author}`);
      lines.push('');
      lines.push(`*Дата: ${date}*`);
      lines.push('');
      
      if (comment.text) {
        lines.push(comment.text);
      } else {
        lines.push('*(Комментарий без текста)*');
      }
      
      lines.push('');
      lines.push('---');
      lines.push('');
    });
  } else if (issue.comments && issue.comments.length === 0) {
    lines.push('## Комментарии');
    lines.push('');
    lines.push('Комментариев нет');
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Get a single issue by key
 * @param {string} issueKey - Issue key (e.g., 'CRM-47926')
 * @param {Object} options - Options for fetching issue
 * @param {boolean} options.withComments - If true, also fetch comments
 * @returns {Object} Issue object (with comments if withComments is true)
 */
function getIssue(issueKey, options = {}) {
  if (!issueKey || typeof issueKey !== 'string') {
    throw new Error('Issue key is required and must be a string');
  }
  
  try {
    // Get issue data - description is always included in the response
    const response = request('GET', `/v3/issues/${issueKey}`);
    const issue = JSON.parse(response);
    
    // Load comments if requested
    if (options.withComments) {
      try {
        issue.comments = getIssueComments(issueKey);
      } catch (e) {
        // If comments fail to load, log error but don't fail the whole request
        issue.comments = [];
        issue.commentsError = e.message;
      }
    }
    
    return issue;
  } catch (e) {
    throw new Error(`Failed to get issue ${issueKey}: ${e.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (!cmd || cmd === '--help' || cmd === '-h') return usage(0);
  
  if (cmd === 'fetchMy') {
    const openOnly = args.includes('--open-only');
    try {
      const issues = fetchMy({ openOnly });
      process.stdout.write(JSON.stringify(issues, null, 2));
      if (!process.stdout.isTTY) process.stdout.write('\n');
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }
  
  if (cmd === 'get') {
    const issueKey = args[1];
    if (!issueKey) {
      console.error('Error: Issue key is required');
      return usage(2);
    }
    const withComments = args.includes('--with-comments');
    const formatMarkdown = args.includes('--format') && args[args.indexOf('--format') + 1] === 'markdown';
    
    try {
      const issue = getIssue(issueKey, { withComments });
      
      if (formatMarkdown) {
        const markdown = formatIssueAsMarkdown(issue);
        process.stdout.write(markdown);
        if (!process.stdout.isTTY) process.stdout.write('\n');
      } else {
        process.stdout.write(JSON.stringify(issue, null, 2));
        if (!process.stdout.isTTY) process.stdout.write('\n');
      }
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }
  
  if (cmd === 'request') {
    const [method, path, body] = args.slice(1);
    if (!method || !path) return usage(2);
    
    const out = request(method, path, body);
    process.stdout.write(out);
    if (out && !out.endsWith('\n')) process.stdout.write('\n');
    return;
  }
  
  return usage(2);
}

// Export functions for use as a module
if (require.main === module) {
  // Running as a script
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
} else {
  // Being required as a module
  module.exports = {
    request,
    fetchMy,
    getMyLogin,
    getIssue,
    getIssueComments,
    formatIssueAsMarkdown,
  };
}

