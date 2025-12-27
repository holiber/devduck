#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { print, symbols } from '../utils.js';
import { readEnvFile } from '../lib/env.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import { getProjectNameFromSrc } from './install-common.js';
import type { ProjectLinkResult } from './install-state.js';

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function createSymlink(linkPath: string, targetPath: string): { ok: boolean; error?: string } {
  try {
    if (fs.existsSync(linkPath)) {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink()) {
        const cur = fs.readlinkSync(linkPath);
        const curResolved = path.resolve(path.dirname(linkPath), cur);
        const expected = path.resolve(targetPath);
        if (curResolved === expected) return { ok: true };
        fs.unlinkSync(linkPath);
      } else {
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    }
    fs.symlinkSync(path.resolve(targetPath), linkPath);
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.message };
  }
}

export async function installStep3DownloadProjects(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; projects: ProjectLinkResult[] }> {
  const { workspaceRoot, config, log } = params;

  print(`\n[Step 3] Download projects...`, 'cyan');
  log(`[step-3] Download projects`);

  const projectsDir = path.join(workspaceRoot, 'projects');
  ensureDir(projectsDir);

  const envFile = path.join(workspaceRoot, '.env');
  const env = readEnvFile(envFile);

  const projects = Array.isArray(config.projects) ? config.projects : [];
  if (projects.length === 0) {
    print(`  ${symbols.info} No projects configured`, 'cyan');
    print(`\n${symbols.success} Step 3 completed`, 'green');
    return { ok: true, projects: [] };
  }

  const results: ProjectLinkResult[] = [];

  for (const p of projects) {
    const src = p.src;
    const name = getProjectNameFromSrc(src);
    const destPath = path.join(projectsDir, name);

    if (!src || typeof src !== 'string') {
      results.push({ name, src, ok: false, kind: 'error', error: 'Missing project src' });
      print(`  ${symbols.warning} ${name}: missing src`, 'yellow');
      continue;
    }

    // Arcadia: symlink into ARCADIA checkout
    if (src.startsWith('arc://')) {
      let arcadiaRoot = env.ARCADIA || process.env.ARCADIA || '~/arcadia';
      arcadiaRoot = arcadiaRoot.replace(/^~/, process.env.HOME || '');
      const arcPath = src.replace(/^arc:\/\//, '');
      const target = path.join(arcadiaRoot, arcPath);
      const link = createSymlink(destPath, target);
      if (link.ok) {
        results.push({ name, src, ok: true, kind: 'symlink', path: destPath });
        print(`  ${symbols.success} ${name}: linked`, 'green');
      } else {
        results.push({ name, src, ok: false, kind: 'error', error: link.error, path: destPath });
        print(`  ${symbols.warning} ${name}: symlink failed (${link.error})`, 'yellow');
      }
      continue;
    }

    // Local folder: symlink
    const maybeLocal = path.isAbsolute(src) ? src : path.resolve(workspaceRoot, src);
    try {
      if (fs.existsSync(maybeLocal) && fs.statSync(maybeLocal).isDirectory()) {
        const link = createSymlink(destPath, maybeLocal);
        if (link.ok) {
          results.push({ name, src, ok: true, kind: 'symlink', path: destPath });
          print(`  ${symbols.success} ${name}: linked`, 'green');
        } else {
          results.push({ name, src, ok: false, kind: 'error', error: link.error, path: destPath });
          print(`  ${symbols.warning} ${name}: symlink failed (${link.error})`, 'yellow');
        }
        continue;
      }
    } catch {
      // ignore
    }

    // Git: clone or update
    if (src.includes('github.com') || src.startsWith('git@') || src.startsWith('http://') || src.startsWith('https://')) {
      ensureDir(projectsDir);

      if (fs.existsSync(destPath) && fs.existsSync(path.join(destPath, '.git'))) {
        print(`  ${symbols.info} ${name}: updating git repo`, 'cyan');
        const pull = spawnSync('git', ['pull'], { cwd: destPath, encoding: 'utf8' });
        if (pull.status === 0) {
          results.push({ name, src, ok: true, kind: 'git-clone', path: destPath });
          print(`  ${symbols.success} ${name}: updated`, 'green');
        } else {
          results.push({
            name,
            src,
            ok: false,
            kind: 'error',
            path: destPath,
            error: (pull.stderr || pull.stdout || 'git pull failed').toString()
          });
          print(`  ${symbols.warning} ${name}: update failed (using existing)`, 'yellow');
        }
        continue;
      }

      // Normalize "github.com/user/repo" to HTTPS for CI compatibility
      let gitUrl = src;
      if (gitUrl.includes('github.com') && !gitUrl.startsWith('git@') && !gitUrl.startsWith('http')) {
        gitUrl = `https://github.com/${gitUrl.replace(/^github\.com\//, '').replace(/\.git$/, '')}.git`;
      }

      print(`  ${symbols.info} ${name}: cloning`, 'cyan');
      const clone = spawnSync('git', ['clone', gitUrl, destPath], { encoding: 'utf8' });
      if (clone.status === 0) {
        results.push({ name, src, ok: true, kind: 'git-clone', path: destPath });
        print(`  ${symbols.success} ${name}: cloned`, 'green');
      } else {
        results.push({
          name,
          src,
          ok: false,
          kind: 'error',
          path: destPath,
          error: (clone.stderr || clone.stdout || 'git clone failed').toString()
        });
        print(`  ${symbols.warning} ${name}: clone failed`, 'yellow');
      }
      continue;
    }

    results.push({ name, src, ok: true, kind: 'noop' });
    print(`  ${symbols.info} ${name}: nothing to do`, 'cyan');
  }

  const ok = results.every((r) => r.ok);
  if (!ok) {
    print(`\n${symbols.warning} Step 3 warning: one or more projects failed to materialize`, 'yellow');
    return { ok: false, projects: results };
  }

  print(`\n${symbols.success} Step 3 completed`, 'green');
  return { ok: true, projects: results };
}

