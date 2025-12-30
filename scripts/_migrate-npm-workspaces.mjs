import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const repoRoot = '/workspace';
const extensionsRoot = path.join(repoRoot, 'extensions');

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

function parseModuleMdFrontmatter(md) {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  try {
    const parsed = parseYaml(fm[1]);
    if (!parsed || typeof parsed !== 'object') return null;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return null;
  }
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

  return { wrotePkg, stripped };
}

function migrateExtensionImports() {
  const importRe1 = /from\s+(['"])(?:\.\.\/)+src\/(?:lib|install)\/[^'"]+\.js\1/g;
  const importRe2 = /from\s+(['"])(?:\.\.\/)+src\/utils\.js\1/g;

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
    const next = txt.replace(importRe1, "from '@barducks/sdk'").replace(importRe2, "from '@barducks/sdk'");
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

