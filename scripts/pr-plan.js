#!/usr/bin/env node

/**
 * PR plan generator/parser.
 *
 * Contract:
 * - The generated plan MUST strictly follow templates/pr.plan.md shape.
 * - The plan is the single source of truth for PR title and PR description.
 * - PR description is taken from the `## PR Description` block only.
 */

const fs = require('fs');
const path = require('path');

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function safePlanName(name) {
  return String(name || 'pr')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'pr';
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function parseArgs() {
  const args = process.argv.slice(2);

  const getValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] || null;
  };

  return {
    generate: args.includes('--generate'),
    parse: args.includes('--parse'),
    validate: args.includes('--validate'),
    fromStdin: args.includes('--from-stdin'),
    input: getValue('--input'),
    out: getValue('--out'),
    name: getValue('--name'),
  };
}

function loadTemplate() {
  const p = path.join(getProjectRoot(), 'templates', 'pr.plan.md');
  return fs.readFileSync(p, 'utf8');
}

function allowedSuggestionSections() {
  return new Set([
    'AI Suggestions — Documentation',
    'AI Suggestions — Unreachable Code Cleanup',
    'AI Suggestions — Recipes',
  ]);
}

function buildPlan({
  titleLine,
  prDescriptionIntro,
  iconBullets,
  suggestionSections = [],
  additionalNotes = '',
}) {
  // Strict order and separators.
  const lines = [];

  lines.push(titleLine);
  lines.push('');
  lines.push('## PR Description');
  lines.push('');
  lines.push(prDescriptionIntro);
  lines.push('');
  for (const b of iconBullets) lines.push(b);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const sec of suggestionSections) {
    lines.push(`## ${sec.heading}`);
    lines.push('');
    for (const l of sec.lines) lines.push(l);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (additionalNotes && String(additionalNotes).trim()) {
    lines.push('## Additional Notes');
    lines.push('');
    lines.push(String(additionalNotes).trim());
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Footer is only meaningful when the plan contains actionable suggestions/notes.
  const hasSuggestions = Array.isArray(suggestionSections) && suggestionSections.length > 0;
  const hasNotes = Boolean(additionalNotes && String(additionalNotes).trim());
  if (hasSuggestions || hasNotes) {
    lines.push('Please check sections or items to implement with AI');
    lines.push('');
  }

  return lines.join('\n');
}

function deriveDefaultTitle(analysis) {
  // Prefer ticket-like subject from branch commits, fallback to branch.
  const branch = String(analysis.branch || '').trim();
  const firstCommit = Array.isArray(analysis.branchCommits) ? analysis.branchCommits[0]?.message : null;
  const raw = (firstCommit && String(firstCommit).trim()) || branch || 'PR';
  // Drop arc log decorations like "(HEAD -> dev2, ...)".
  const candidate = raw.replace(/^\([^)]*\)\s*/, '');
  // Template expects "# <title>"
  return `# ${candidate.replace(/^#\s+/, '')}`;
}

function derivePRDescriptionIntro(analysis) {
  // Keep it short; the template expects a single paragraph.
  const pr = analysis.existingPR;
  if (pr && pr.summary) {
    const s = String(pr.summary).trim();
    return s.toLowerCase().startsWith('update ')
      ? `This PR updates ${s.slice('update '.length).trim()}.`
      : `This PR updates ${s}.`;
  }
  return 'This PR updates the codebase.';
}

function requireDiffAvailable(analysis) {
  // `scripts/pr.js` sets diffAvailable and provides prChangedFiles/prChangedDirs.
  if (analysis && analysis.diffAvailable === false) return { ok: false, error: 'diffAvailable=false' };
  if (!analysis || !Array.isArray(analysis.prChangedFiles)) return { ok: false, error: 'prChangedFiles missing' };
  return { ok: true, error: null };
}

function summarizeAreasFromChangedFiles(changedFiles) {
  const areas = new Set();
  for (const f of changedFiles) {
    const filePath = String(f.file || '');
    const parts = filePath.split('/').filter(Boolean);

    // Arcadia working copies often: junk/<user>/<project>/<area>/...
    if (parts[0] === 'junk' && parts.length >= 4) {
      areas.add(parts[3]);
      continue;
    }

    // Otherwise, use first segment or filename for root-level files.
    if (parts.length === 1) {
      areas.add(parts[0]);
    } else if (parts.length > 1) {
      // Special-case .cursor/commands as a meaningful “area”.
      if (parts[0] === '.cursor' && parts[1] === 'commands') {
        areas.add('.cursor/commands');
      } else {
        areas.add(parts[0]);
      }
    }
  }
  return Array.from(areas);
}

function classifyIconBulletsFromAreas(analysis) {
  const changedFiles = analysis.prChangedFiles || [];
  const areas = summarizeAreasFromChangedFiles(changedFiles);

  // Build multiple bullets. No filenames, but areas are allowed.
  const bullets = [];
  const add = (line) => bullets.push(line);

  const hasArea = (a) => areas.includes(a);
  const anyArea = (pred) => areas.some(pred);

  // Docs bullets per area (no collapsing).
  if (hasArea('recipes')) {
    add('- 📖 — add/update `recipes/` documentation');
  }
  if (hasArea('ai.config.json') || anyArea((a) => a.includes('ai.config'))) {
    add('- 📖 — update `ai.config.json` commands documentation');
  }
  if (hasArea('.cursor/commands')) {
    add('- 📖 — clarify `/pr` and `/commit` workflow instructions');
  }
  if (hasArea('ROADMAP.md') || anyArea((a) => a.toLowerCase().includes('roadmap'))) {
    add('- 📖 — update roadmap items related to PR/commit templates');
  }
  if (hasArea('templates')) {
    add('- 📖 — update PR plan template');
  }

  // Non-doc bullets for workflow tooling changes.
  if (hasArea('scripts')) {
    add('- ♻️ — generate strict PR plans from diff (no file lists); source PR title/description from plan');
  }

  // Cleanup signal if we detect plan archiving behavior.
  const text = areas.join('\n').toLowerCase();
  if (text.includes('trash')) {
    add('- 🧹 — archive used plan files to `.cache/trash/`');
  }

  // Tests if tests changed.
  const hasTests = changedFiles.some((f) => /test|spec/i.test(String(f.file || '')));
  if (hasTests) {
    add('- 🧪 — update/add tests');
  }

  // If still empty, produce a minimal but non-file-list summary.
  if (bullets.length === 0) {
    add('- ♻️ — update internal tooling and documentation');
  }

  return bullets;
}

function deriveSuggestionSections(_analysis) {
  // If we have no concrete suggestions, do not output empty suggestion sections.
  // This keeps the plan minimal and avoids checklists that don't correspond to real proposals.
  return [];
}

function validatePlanShape(planText) {
  const errors = [];
  const lines = planText.split('\n');
  if (!lines[0] || !lines[0].startsWith('# ')) {
    errors.push('First line must be a title starting with "# ".');
  }

  const hasPRDesc = planText.includes('\n## PR Description\n');
  if (!hasPRDesc) errors.push('Missing required heading: "## PR Description".');

  // Disallow sections that were a problem.
  for (const forbidden of ['## Summary', '## Changed Files', '## Affected Areas']) {
    if (planText.includes(`\n${forbidden}\n`)) {
      errors.push(`Forbidden heading present: "${forbidden}".`);
    }
  }

  // Only allow specific AI suggestion sections + Additional Notes.
  const allowed = new Set([...allowedSuggestionSections(), 'Additional Notes', 'PR Description']);
  for (const l of lines) {
    const m = l.match(/^##\s+(.*)$/);
    if (!m) continue;
    const heading = m[1].trim();
    const normalized = heading.replace(/^\[[ xX]\]\s+/, '');
    if (!allowed.has(normalized)) {
      errors.push(`Unexpected heading: "## ${heading}".`);
    }
  }

  return errors;
}

function parsePlan(planText) {
  const lines = planText.split('\n');
  const titleLine = lines[0] || '';
  const title = titleLine.replace(/^#\s+/, '').trim();

  const marker = '## PR Description';
  const idx = lines.findIndex((l) => l.trim() === marker);
  if (idx === -1) {
    return { title, description: '' };
  }

  const descLines = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('## ')) break;
    if (l.trim() === '---') break;
    descLines.push(l);
  }

  // Trim leading/trailing empty lines.
  while (descLines.length && !descLines[0].trim()) descLines.shift();
  while (descLines.length && !descLines[descLines.length - 1].trim()) descLines.pop();

  return { title, description: descLines.join('\n') };
}

async function main() {
  const opts = parseArgs();

  if (opts.parse || opts.validate) {
    const p = opts.input;
    if (!p) {
      console.error('Missing --input <plan-path>');
      process.exit(1);
    }
    const planText = fs.readFileSync(p, 'utf8');
    const parsed = parsePlan(planText);
    const errors = validatePlanShape(planText);
    const out = { ok: errors.length === 0, errors, ...parsed };
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.ok ? 0 : 2);
  }

  // Default mode: generate
  const template = loadTemplate(); // ensures file exists
  void template; // we don't interpolate, we generate strictly in code.

  let analysisText = '';
  if (opts.fromStdin) {
    analysisText = await readStdin();
  } else if (opts.input) {
    analysisText = fs.readFileSync(opts.input, 'utf8');
  } else {
    console.error('Provide analysis JSON via --from-stdin or --input <json-path>.');
    process.exit(1);
  }

  let analysis;
  try {
    analysis = JSON.parse(analysisText);
  } catch (e) {
    console.error(`Failed to parse analysis JSON: ${e.message}`);
    process.exit(1);
  }

  // Store PR plans under .cache/tasks to avoid creating .cache/plans repeatedly.
  // Task-specific wiring can override --out in the caller (scripts/pr.js).
  const planDir = path.join(getProjectRoot(), '.cache', 'tasks', 'pr');
  ensureDir(planDir);

  const diffCheck = requireDiffAvailable(analysis);
  if (!diffCheck.ok) {
    console.error(`Cannot generate plan: diff is required but not available (${diffCheck.error}).`);
    process.exit(2);
  }

  const baseName = safePlanName(opts.name || (analysis.existingPR?.id ? `pr-${analysis.existingPR.id}` : analysis.branch));
  const planPath = opts.out
    ? path.resolve(opts.out)
    : path.join(planDir, `${baseName}.plan.md`);

  const planText = buildPlan({
    titleLine: deriveDefaultTitle(analysis),
    prDescriptionIntro: derivePRDescriptionIntro(analysis),
    iconBullets: classifyIconBulletsFromAreas(analysis),
    suggestionSections: deriveSuggestionSections(analysis),
    additionalNotes: '',
  });

  const errors = validatePlanShape(planText);
  if (errors.length > 0) {
    console.error('Refusing to write invalid plan:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(2);
  }

  fs.writeFileSync(planPath, planText, 'utf8');

  const parsed = parsePlan(planText);
  console.log(JSON.stringify({ planPath, ...parsed }, null, 2));
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});

