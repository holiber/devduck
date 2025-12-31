import fs from 'node:fs';
import path from 'node:path';

/**
 * Migration helper: generate per-extension package.json metadata, strip MODULE.md YAML frontmatter,
 * and rewrite brittle relative imports to '@barducks/sdk'.
 *
 * This script supports running against any repository that follows the `extensions/<name>/...` layout.
 *
 * Usage:
 *   node scripts/_migrate-npm-workspaces.mjs --repo-root <path> --extensions-dir <path>
 *
 * Defaults:
 *   --repo-root       = process.cwd()
 *   --extensions-dir  = <repo-root>/extensions
 */

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv);
const repoRoot = path.resolve(typeof args['repo-root'] === 'string' ? args['repo-root'] : process.cwd());
const extensionsRoot = path.resolve(
  typeof args['extensions-dir'] === 'string' ? args['extensions-dir'] : path.join(repoRoot, 'extensions')
);

function readFileIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function writeFileIfChanged(p, content) {
  const prev = readFileIfExists(p);
  if (prev === content) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return true;
}

function stripYamlFrontmatter(md) {
  const m = md.match(/^---\n[\s\S]*?\n---\n?/);
  if (!m) return { stripped: md, hadFrontmatter: false };
  return { stripped: md.slice(m[0].length), hadFrontmatter: true };
}

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseScalar(raw) {
  const s = stripQuotes(String(raw ?? '').trim());
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseInlineArray(raw) {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  // Very small subset: split by commas not inside quotes.
  const parts = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) {
      cur += ch;
      if (ch === q && inner[i - 1] !== '\\') q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur.trim());
  return parts.map((p) => parseScalar(p));
}

function parseSimpleYamlBlock(lines, startIdx, parentIndent) {
  // Parses a limited YAML subset (enough for our MODULE.md frontmatter).
  // Returns { value, nextIdx }.
  /** @type {Record<string, unknown> | unknown[]} */
  let container = {};
  let asArray = false;

  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent <= parentIndent) break;

    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      if (!asArray) {
        asArray = true;
        container = [];
      }

      const itemRaw = trimmed.slice(2).trim();
      if (itemRaw.includes(':')) {
        // Array item is an object starting on the same line: "- key: value"
        /** @type {Record<string, unknown>} */
        const obj = {};
        const colon = itemRaw.indexOf(':');
        const k = itemRaw.slice(0, colon).trim();
        const vRaw = itemRaw.slice(colon + 1).trim();
        if (vRaw === '') {
          const nested = parseSimpleYamlBlock(lines, i + 1, indent);
          obj[k] = nested.value;
          i = nested.nextIdx;
        } else {
          const arr = parseInlineArray(vRaw);
          obj[k] = arr !== null ? arr : parseScalar(vRaw);
          i++;
        }

        // Consume additional sibling keys of this object at the same indent+2
        while (i < lines.length) {
          const l2 = lines[i];
          if (!l2.trim()) {
            i++;
            continue;
          }
          const ind2 = l2.match(/^ */)?.[0].length ?? 0;
          if (ind2 <= indent) break;
          const t2 = l2.trim();
          if (t2.startsWith('- ')) break;
          const m2 = t2.match(/^([^:]+):\s*(.*)$/);
          if (!m2) break;
          const kk = m2[1].trim();
          const vv = m2[2].trim();
          if (vv === '') {
            const nested2 = parseSimpleYamlBlock(lines, i + 1, ind2);
            obj[kk] = nested2.value;
            i = nested2.nextIdx;
          } else {
            const arr2 = parseInlineArray(vv);
            obj[kk] = arr2 !== null ? arr2 : parseScalar(vv);
            i++;
          }
        }

        container.push(obj);
        continue;
      }

      // Scalar array item
      container.push(parseScalar(itemRaw));
      i++;
      continue;
    }

    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }

    const key = m[1].trim();
    const rest = m[2].trim();
    if (rest === '') {
      const nested = parseSimpleYamlBlock(lines, i + 1, indent);
      container[key] = nested.value;
      i = nested.nextIdx;
      continue;
    }

    const arr = parseInlineArray(rest);
    container[key] = arr !== null ? arr : parseScalar(rest);
    i++;
  }

  return { value: container, nextIdx: i };
}

function parseModuleMdFrontmatter(md) {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const raw = fm[1];
  const lines = raw.split('\n');
  const parsed = parseSimpleYamlBlock(lines, 0, -1).value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return /** @type {Record<string, unknown>} */ (parsed);
}

function normalizeStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

function normalizeObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v;
}

function normalizeChecks(v) {
  if (!Array.isArray(v)) return undefined;
  return v;
}

function buildExtensionPackageJson(args) {
  const {
    dirName,
    moduleName,
    version,
    description,
    tags,
    dependencies,
    defaultSettings,
    checks,
    mcpSettings
  } = args;

  /** @type {Record<string, unknown>} */
  const extMeta = {
    name: moduleName,
    tags,
    dependencies,
    defaultSettings: defaultSettings || {},
    ...(checks ? { checks } : {}),
    ...(mcpSettings ? { mcpSettings } : {})
  };

  /** @type {Record<string, unknown>} */
  const pkg = {
    name: `@barducks/extension-${dirName}`,
    version,
    private: true,
    type: 'module',
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { keywords: tags } : {}),
    barducks: {
      extension: extMeta
    }
  };

  return JSON.stringify(pkg, null, 2) + '\n';
}

function listImmediateDirs(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function migrateExtension(dirName) {
  const modulePath = path.join(extensionsRoot, dirName);
  const moduleMdPath = path.join(modulePath, 'MODULE.md');
  const pkgPath = path.join(modulePath, 'package.json');

  // If the extension already declares barducks.extension metadata in package.json,
  // do NOT overwrite it. This makes the script safe to re-run.
  const existingPkgRaw = readFileIfExists(pkgPath);
  if (existingPkgRaw) {
    try {
      const existingPkg = JSON.parse(existingPkgRaw);
      const extMeta = existingPkg?.barducks?.extension || existingPkg?.barducksExtension;
      if (extMeta && typeof extMeta === 'object') {
        return { wrotePkg: false, stripped: false, skipped: true };
      }
    } catch {
      // ignore and continue with migration attempt
    }
  }

  const moduleMd = readFileIfExists(moduleMdPath);
  const frontmatter = moduleMd ? parseModuleMdFrontmatter(moduleMd) : null;

  const moduleName =
    (frontmatter && typeof frontmatter.name === 'string' && frontmatter.name.trim()) || dirName;
  const version =
    (frontmatter && typeof frontmatter.version === 'string' && frontmatter.version.trim()) || '0.1.0';
  const description =
    (frontmatter && typeof frontmatter.description === 'string' && frontmatter.description.trim()) || '';
  const tags = normalizeStringArray(frontmatter?.tags);
  const dependencies = normalizeStringArray(frontmatter?.dependencies);
  const defaultSettings = normalizeObject(frontmatter?.defaultSettings);
  const checks = normalizeChecks(frontmatter?.checks);
  const mcpSettings = normalizeObject(frontmatter?.mcpSettings);

  const pkgJson = buildExtensionPackageJson({
    dirName,
    moduleName,
    version,
    description,
    tags,
    dependencies,
    defaultSettings,
    checks,
    mcpSettings
  });

  const wrotePkg = writeFileIfChanged(pkgPath, pkgJson);

  let strippedMd = moduleMd;
  let stripped = false;
  if (moduleMd) {
    const res = stripYamlFrontmatter(moduleMd);
    strippedMd = res.stripped;
    stripped = res.hadFrontmatter;
    if (stripped) {
      writeFileIfChanged(moduleMdPath, strippedMd);
    }
  }

  return { wrotePkg, stripped, skipped: false };
}

function migrateExtensionImports() {
  // Rewrite known brittle relative imports to monorepo internals / contracts.
  // Keep this conservative: only rewrite clearly cross-repo paths.
  const rules = [
    // Old built-in style: "../../../src/lib/..." or "../../../src/install/..." or "../../../src/utils.js"
    { re: /from\s+(['"])(?:\.\.\/)+src\/(?:lib|install)\/[^'"]+\.js\1/g, to: "from '@barducks/sdk'" },
    { re: /from\s+(['"])(?:\.\.\/)+src\/utils\.js\1/g, to: "from '@barducks/sdk'" },

    // External repos sometimes hardcode workspace layout:
    // "../../../../projects/barducks/..." or "../../../../projects/devduck/..."
    // Map known contracts/hooks paths into @barducks/sdk.
    {
      re: /from\s+(['"])(?:\.\.\/)+projects\/(?:barducks|devduck)\/scripts\/install\/module-hooks\.js\1/g,
      to: "from '@barducks/sdk'"
    },
    {
      re: /from\s+(['"])(?:\.\.\/)+projects\/(?:barducks|devduck)\/extensions\/ci\/schemas\/contract\.ts\1/g,
      to: "from '@barducks/sdk'"
    },
    {
      re: /from\s+(['"])(?:\.\.\/)+projects\/(?:barducks|devduck)\/extensions\/issue-tracker\/schemas\/contract\.ts\1/g,
      to: "from '@barducks/sdk'"
    }
  ];

  /** @param {string} dir */
  function walk(dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|js|mjs)$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  const files = walk(extensionsRoot);
  let changed = 0;

  for (const f of files) {
    const txt = readFileIfExists(f);
    if (!txt) continue;
    let next = txt;
    for (const r of rules) next = next.replace(r.re, r.to);
    if (next !== txt) {
      writeFileIfChanged(f, next);
      changed++;
    }
  }

  return changed;
}

const dirs = listImmediateDirs(extensionsRoot);
let pkgCount = 0;
let strippedCount = 0;

for (const d of dirs) {
  const res = migrateExtension(d);
  if (res.wrotePkg) pkgCount++;
  if (res.stripped) strippedCount++;
}

const importChanged = migrateExtensionImports();

console.log(
  JSON.stringify(
    {
      extensions: dirs.length,
      packageJsonWritten: pkgCount,
      moduleMdFrontmatterStripped: strippedCount,
      filesWithImportChanges: importChanged
    },
    null,
    2
  )
);

