#!/usr/bin/env node
/**
 * Enforce strict stage-by-stage PR workflow for Cursor Cloud Agents (barducks 🦆).
 *
 * This check MUST only apply to agent PRs: title starts with "[🦆 <short-task-name>]".
 *
 * Verified rules (see docs task spec):
 * - Agent PR detection by title prefix
 * - Exactly one new task file added under docs/tasks/YYYY-MM-DD-HHMM-<short-task-name>.md
 * - Task file has Stage: 0..6 in "## 0. Meta"
 * - Required sections by stage + forbidden "## 1. Intake" for stage >= 1
 * - Required CHECKPOINT lines in "## 2. Status Log" up to declared stage
 * - Stage monotonicity across PR commits (no decreases; no jumps > +1; first stage must be 0)
 * - Exactly one PR comment containing "<!-- barducks-agent-status -->"
 * - Status comment contains one allowed status; fixing-ci attempt is capped at 5 and must be consistent with CI Attempts section
 *
 * Required GitHub Actions permissions:
 * - contents: read (to read repo contents at commit refs)
 * - pull-requests: read (to list PR files/commits and read PR comments via GraphQL)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function warn(message) {
  process.stderr.write(`${message}\n`);
}

function ok(message) {
  process.stdout.write(`${message}\n`);
}

function readRequiredEnv(name) {
  const v = process.env[name];
  if (!v) die(`[agent-workflow] missing env ${name}`);
  return v;
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseRepo(full) {
  const [owner, repo] = (full ?? '').split('/');
  if (!owner || !repo) die(`[agent-workflow] invalid GITHUB_REPOSITORY: ${full}`);
  return { owner, repo };
}

async function ghFetchJson(url, { token, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'barducks-agent-workflow-check',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    die(`[agent-workflow] GitHub API error ${res.status} ${res.statusText} for ${url}\n${txt}`.trim());
  }
  return await res.json();
}

async function ghPaginate(urlBase, { token, perPage = 100 } = {}) {
  const out = [];
  for (let page = 1; page < 1000; page++) {
    const url = `${urlBase}${urlBase.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`;
    const pageData = await ghFetchJson(url, { token });
    if (!Array.isArray(pageData)) die(`[agent-workflow] expected array response from ${url}`);
    out.push(...pageData);
    if (pageData.length < perPage) break;
  }
  return out;
}

async function ghGraphql(query, variables, { token }) {
  const url = 'https://api.github.com/graphql';
  const json = await ghFetchJson(url, { token, method: 'POST', body: { query, variables } });
  if (json?.errors?.length) {
    die(`[agent-workflow] GraphQL error: ${JSON.stringify(json.errors, null, 2)}`);
  }
  return json?.data;
}

function isAgentTitle(title) {
  return /^\[🦆\s+[^\]]+\]/.test(title ?? '');
}

function normalizeElliipsis(s) {
  // Some authors may type "..." instead of the single ellipsis "…".
  return String(s ?? '').replaceAll('...', '…');
}

function sliceSection(markdown, heading) {
  const re = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, 'm');
  const m = markdown.match(re);
  if (!m || m.index == null) return null;
  const start = m.index + m[0].length;

  const rest = markdown.slice(start);
  const next = rest.search(/^##\s+/m);
  if (next === -1) return rest;
  return rest.slice(0, next);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listHeadings(markdown) {
  const out = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(markdown))) {
    out.push(m[1].trim());
  }
  return out;
}

function parseStageFromMeta(markdown) {
  const meta = sliceSection(markdown, '0. Meta');
  if (meta == null) return { stage: null, error: 'Missing section "## 0. Meta".' };

  // Accept "- Stage: 3" or "* Stage: 3" or "Stage: 3"
  const m = meta.match(/^\s*([-*]\s*)?Stage:\s*(\d+)\s*$/mi);
  if (!m) return { stage: null, error: 'Missing "Stage: N" in "## 0. Meta".' };
  const stage = Number(m[2]);
  if (!Number.isInteger(stage)) return { stage: null, error: 'Invalid "Stage: N" (not an integer).' };
  if (stage < 0 || stage > 6) return { stage: null, error: 'Invalid stage. Must be an integer 0..6.' };
  return { stage, error: null };
}

function parseCheckpoints(markdown) {
  const status = sliceSection(markdown, '2. Status Log');
  if (status == null) return { checkpoints: new Set(), error: 'Missing section "## 2. Status Log".' };

  const set = new Set();
  const re = /CHECKPOINT:\s*Stage\s+(\d+)\s+pushed/gi;
  let m;
  while ((m = re.exec(status))) {
    const n = Number(m[1]);
    if (Number.isInteger(n)) set.add(n);
  }
  return { checkpoints: set, error: null };
}

function requireHeadingsForStage({ headings, stage }) {
  const has = (h) => headings.includes(h);

  const errors = [];

  if (!has('0. Meta')) errors.push('Missing required section: "## 0. Meta".');
  if (!has('2. Status Log')) errors.push('Missing required section: "## 2. Status Log".');

  if (stage >= 1) {
    if (!has('1. Task')) errors.push('Stage >= 1 requires section: "## 1. Task".');
    if (has('1. Intake')) errors.push('Stage >= 1 MUST NOT contain section: "## 1. Intake".');
  }
  if (stage >= 2) {
    if (!has('3. Plan')) errors.push('Stage >= 2 requires section: "## 3. Plan".');
  }
  if (stage >= 4) {
    if (!has('4. Implementation Notes')) errors.push('Stage >= 4 requires section: "## 4. Implementation Notes".');
  }
  if (stage >= 5) {
    if (!has('6. Final Report')) errors.push('Stage >= 5 requires section: "## 6. Final Report".');
  }

  return errors;
}

function requireCheckpointsUpTo({ checkpoints, stage }) {
  const missing = [];
  for (let i = 0; i <= stage; i++) {
    if (!checkpoints.has(i)) missing.push(i);
  }
  if (missing.length === 0) return null;
  const list = missing.map((n) => `Stage ${n} pushed`).join(', ');
  return `Missing required checkpoints in "## 2. Status Log": ${list}.`;
}

async function fetchPullRequestCommentsViaGraphql({ owner, repo, prNumber, token }) {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          comments(first: 100, after: $cursor) {
            nodes { body }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;

  const bodies = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const data = await ghGraphql(query, { owner, repo, number: prNumber, cursor }, { token });
    const pr = data?.repository?.pullRequest;
    const conn = pr?.comments;
    const nodes = conn?.nodes ?? [];
    for (const n of nodes) bodies.push(String(n?.body ?? ''));
    const pi = conn?.pageInfo;
    if (!pi?.hasNextPage) break;
    cursor = pi?.endCursor ?? null;
    if (!cursor) break;
  }
  return bodies;
}

function parseAgentStatusFromComment(bodyRaw) {
  const body = normalizeElliipsis(bodyRaw);

  const marker = '<!-- barducks-agent-status -->';
  if (!body.includes(marker)) return { ok: false, error: 'Missing required marker in status comment.' };

  const allowedFixed = [
    'intake…',
    'planning…',
    'implementing…',
    'writing report…',
    'waiting for ci…',
    'job is done ✅',
    'failed to fix ci after 5 attempts ❌',
  ];

  const matches = [];
  for (const s of allowedFixed) if (body.includes(s)) matches.push({ kind: 'fixed', value: s });

  const fixingRe = /fixing ci \(attempt (\d+)\/5\)…/;
  const fixing = body.match(fixingRe);
  if (fixing) matches.push({ kind: 'fixing', attempt: Number(fixing[1]) });

  if (matches.length === 0) {
    return {
      ok: false,
      error:
        'Status comment must include exactly one allowed status: ' +
        allowedFixed
          .slice(0, 5)
          .concat(['fixing ci (attempt X/5)…'])
          .concat(allowedFixed.slice(5))
          .map((s) => `"${s}"`)
          .join(', ') +
        '.',
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `Status comment must include exactly one allowed status, but multiple were found: ${matches
        .map((m) => (m.kind === 'fixing' ? `fixing ci (attempt ${m.attempt}/5)…` : m.value))
        .join(', ')}.`,
    };
  }

  const m = matches[0];
  if (m.kind === 'fixing') {
    if (!Number.isInteger(m.attempt) || m.attempt < 1 || m.attempt > 5) {
      return { ok: false, error: 'Invalid status: "fixing ci (attempt X/5)…" must have X between 1 and 5.' };
    }
    return { ok: true, status: 'fixing', attempt: m.attempt };
  }

  if (m.value === 'failed to fix ci after 5 attempts ❌') return { ok: true, status: 'failed' };
  if (m.value === 'job is done ✅') return { ok: true, status: 'done' };
  if (m.value === 'waiting for ci…') return { ok: true, status: 'waiting' };
  // Any other fixed state is OK.
  return { ok: true, status: 'in_progress' };
}

function requireCiAttemptsIfNeeded({ markdown, commentStatus }) {
  const needsAttempts = commentStatus?.status === 'fixing' || commentStatus?.status === 'failed';
  if (!needsAttempts) return [];

  const headings = listHeadings(markdown);
  const errors = [];
  if (!headings.includes('5. CI Attempts')) errors.push('CI failures indicated by status comment require section: "## 5. CI Attempts".');

  // Attempt-specific validation
  const attemptsSection = sliceSection(markdown, '5. CI Attempts') ?? '';
  if (commentStatus?.status === 'fixing') {
    const x = commentStatus.attempt;
    if (!new RegExp(`Attempt\\s+${x}/5`, 'i').test(attemptsSection)) {
      errors.push(`Status "fixing ci (attempt ${x}/5)…" requires an entry "Attempt ${x}/5" in "## 5. CI Attempts".`);
    }
  }
  if (commentStatus?.status === 'failed') {
    if (!/Attempt\s+5\/5/i.test(attemptsSection)) {
      errors.push('Status "failed to fix ci after 5 attempts ❌" requires an entry "Attempt 5/5" in "## 5. CI Attempts".');
    }
  }

  return errors;
}

function requireStage6Checkpoint(markdown) {
  // This is redundant with generic checkpoint check, but keeps the error explicit.
  const { stage } = parseStageFromMeta(markdown);
  if (stage !== 6) return null;
  const status = sliceSection(markdown, '2. Status Log') ?? '';
  if (!/CHECKPOINT:\s*Stage\s+6\s+pushed/i.test(status)) return 'Stage 6 requires checkpoint: "CHECKPOINT: Stage 6 pushed".';
  return null;
}

function validateTaskFileContent({ markdown, commentStatus }) {
  const errors = [];

  const headings = listHeadings(markdown);
  const { stage, error: stageError } = parseStageFromMeta(markdown);
  if (stageError) errors.push(stageError);

  if (stage != null) {
    errors.push(...requireHeadingsForStage({ headings, stage }));
  }

  const { checkpoints, error: cpErr } = parseCheckpoints(markdown);
  if (cpErr) errors.push(cpErr);
  if (stage != null) {
    const miss = requireCheckpointsUpTo({ checkpoints, stage });
    if (miss) errors.push(miss);
  }

  const stage6Cp = requireStage6Checkpoint(markdown);
  if (stage6Cp) errors.push(stage6Cp);

  errors.push(...requireCiAttemptsIfNeeded({ markdown, commentStatus }));

  return { stage, checkpoints, headings, errors };
}

async function fetchRepoFileAtRef({ owner, repo, ref, filePath, token }) {
  // IMPORTANT: The contents API expects path segments, so we must not encode "/" separators.
  const encodedPath = String(filePath)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(api, {
    method: 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'barducks-agent-workflow-check',
    },
  });

  if (res.status === 404) return { ok: false, reason: 'not_found', content: null };
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    die(`[agent-workflow] GitHub contents API error ${res.status} ${res.statusText} for ${api}\n${txt}`.trim());
  }

  const json = await res.json();
  const encoded = json?.content;
  const encoding = json?.encoding;
  if (encoding !== 'base64' || typeof encoded !== 'string') {
    return { ok: false, reason: 'unexpected_response', content: null };
  }
  const content = Buffer.from(encoded.replaceAll('\n', ''), 'base64').toString('utf8');
  return { ok: true, reason: null, content };
}

async function validateStageMonotonicity({ owner, repo, token, commits, taskFilePath }) {
  const errors = [];

  let prev = null;
  let firstObserved = null;

  for (const c of commits) {
    const sha = c?.sha;
    if (!sha) continue;

    const fileAt = await fetchRepoFileAtRef({ owner, repo, token, ref: sha, filePath: taskFilePath });
    if (!fileAt.ok) continue;

    const { stage, error: stageErr } = parseStageFromMeta(fileAt.content);
    if (stageErr) {
      errors.push(`Commit ${sha.slice(0, 7)}: ${stageErr}`);
      continue;
    }
    if (stage == null) continue;

    // Per-commit checkpoint enforcement: at commit stage N, the file must already contain checkpoints 0..N.
    const { checkpoints } = parseCheckpoints(fileAt.content);
    const missingCk = requireCheckpointsUpTo({ checkpoints, stage });
    if (missingCk) {
      errors.push(`Commit ${sha.slice(0, 7)}: ${missingCk}`);
    }

    if (firstObserved == null) firstObserved = stage;
    if (firstObserved !== 0) {
      errors.push(
        `Stage monotonicity: first observed stage in PR history must be 0, but found stage ${firstObserved} (commit ${sha.slice(0, 7)}).`
      );
      // Keep scanning to report additional issues.
      firstObserved = 0; // prevent noisy repeats
    }

    if (prev == null) {
      prev = stage;
      continue;
    }

    if (stage < prev) {
      errors.push(`Stage monotonicity violated: stage decreased from ${prev} to ${stage} at commit ${sha.slice(0, 7)}.`);
    } else if (stage > prev + 1) {
      errors.push(
        `Stage skipping is forbidden: stage jumped from ${prev} to ${stage} at commit ${sha.slice(0, 7)}. Advance one stage at a time and push.`
      );
    }
    prev = stage;
  }

  return errors;
}

function findAddedTaskFile(prFiles) {
  const added = prFiles.filter((f) => f?.status === 'added' && typeof f?.filename === 'string').map((f) => f.filename);

  const addedTasks = added.filter((p) => p.startsWith('docs/tasks/'));
  const validTaskPattern = /^docs\/tasks\/\d{4}-\d{2}-\d{2}-([01]\d|2[0-3])[0-5]\d-[a-z0-9][a-z0-9-]*\.md$/i;
  const valid = addedTasks.filter((p) => validTaskPattern.test(p));

  const errors = [];
  if (valid.length !== 1) {
    errors.push(
      `Agent PR must add exactly one new task file matching "docs/tasks/YYYY-MM-DD-HHMM-<short-task-name>.md". Found: ${valid.length}.`
    );
  }
  if (addedTasks.length !== valid.length) {
    const bad = addedTasks.filter((p) => !validTaskPattern.test(p));
    if (bad.length) {
      errors.push(`Invalid task file path(s) under docs/tasks/: ${bad.join(', ')}.`);
    }
  }
  if (addedTasks.length > 1) {
    errors.push(`Agent PR must add exactly one new task file under docs/tasks/. Added task files: ${addedTasks.join(', ')}.`);
  }

  return { taskFile: valid[0] ?? null, errors };
}

async function main() {
  const eventPath = readRequiredEnv('GITHUB_EVENT_PATH');
  const token = readRequiredEnv('GITHUB_TOKEN');
  const repoFull = readRequiredEnv('GITHUB_REPOSITORY');
  const { owner, repo } = parseRepo(repoFull);

  const event = await readJsonFile(eventPath);
  const pr = event?.pull_request;
  const prNumber = pr?.number;
  const prTitle = pr?.title ?? '';
  if (!prNumber) die('[agent-workflow] unable to determine pull_request.number from event payload');

  if (!isAgentTitle(prTitle)) {
    ok('[agent-workflow] non-agent PR (title does not start with "[🦆 ...]"); skipping strict agent workflow enforcement.');
    return;
  }

  ok(`[agent-workflow] agent PR detected: "${prTitle}" (#${prNumber})`);

  const prFiles = await ghPaginate(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, { token });
  const { taskFile, errors: taskFileErrors } = findAddedTaskFile(prFiles);
  if (taskFileErrors.length) {
    die(`[agent-workflow] task file rule violations:\n- ${taskFileErrors.join('\n- ')}`);
  }
  if (!taskFile) die('[agent-workflow] internal error: expected task file to be present');

  // Validate status comment (exactly one marker)
  const commentBodies = await fetchPullRequestCommentsViaGraphql({ owner, repo, prNumber, token });
  const marker = '<!-- barducks-agent-status -->';
  const statusComments = commentBodies.filter((b) => normalizeElliipsis(b).includes(marker));
  if (statusComments.length === 0) {
    die(
      `[agent-workflow] missing PR status comment.\n- Add exactly one PR comment containing: ${marker}\n- Keep updating that same comment; do not create multiple.`
    );
  }
  if (statusComments.length > 1) {
    die(
      `[agent-workflow] multiple PR status comments found (${statusComments.length}).\n- There must be exactly one comment containing: ${marker}\n- Delete extras and keep one continuously updated.`
    );
  }

  const commentStatus = parseAgentStatusFromComment(statusComments[0]);
  if (!commentStatus.ok) die(`[agent-workflow] invalid PR status comment: ${commentStatus.error}`);

  // Validate task file content at HEAD checkout
  const taskAbs = path.join(process.cwd(), taskFile);
  let markdown;
  try {
    markdown = await fs.readFile(taskAbs, 'utf8');
  } catch {
    die(`[agent-workflow] task file was detected as added ("${taskFile}") but is missing from the checkout.`);
  }

  const taskValidation = validateTaskFileContent({ markdown, commentStatus });
  if (taskValidation.errors.length) {
    die(`[agent-workflow] task file content violations in "${taskFile}":\n- ${taskValidation.errors.join('\n- ')}`);
  }

  // Stage monotonicity across commits (strict stage-by-stage)
  const commits = await ghPaginate(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits`, { token });
  const monoErrors = await validateStageMonotonicity({ owner, repo, token, commits, taskFilePath: taskFile });
  if (monoErrors.length) die(`[agent-workflow] stage monotonicity violations:\n- ${monoErrors.join('\n- ')}`);

  ok('[agent-workflow] ✅ all strict agent PR workflow checks passed');
}

main().catch((err) => {
  warn(String(err?.stack ?? err));
  process.exit(1);
});

