import fs from 'fs';
import path from 'path';

export type FileCheckResult = {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
  error?: string;
};

export type SymlinkResult = {
  // Note: ProjectResult.symlink is used as a flexible “what happened” record,
  // so it may contain nulls or extra fields depending on project type.
  success?: boolean;
  path: string | null;
  target: string | null;
  existed?: boolean;
  created?: boolean;
  exists?: boolean;
  updated?: boolean;
  note?: string;
  error?: string;
};

export type PrintColor = 'reset' | 'green' | 'red' | 'yellow' | 'cyan' | 'blue';

export type InstallerPrinter = (message: string, color?: PrintColor) => void;

export type InstallerSymbols = Record<string, string>;

export function isFilePath(check: string | undefined): boolean {
  if (!check) return false;

  const trimmed = check.trim();

  // If contains spaces, it's likely a command.
  if (trimmed.includes(' ')) return false;

  // If contains command operators, it's a command.
  if (trimmed.includes('&&') || trimmed.includes('||') || trimmed.includes(';') || trimmed.includes('|')) {
    return false;
  }

  // If starts with / or ~, it's likely a file path.
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return true;
  }

  // If contains / and no spaces, it might be a relative path.
  if (trimmed.includes('/')) {
    return true;
  }

  return false;
}

export function checkFileExists(filePath: string, opts: { baseDir: string }): FileCheckResult {
  try {
    const expandedPath = filePath.replace(/^~/, process.env.HOME || '');
    const resolvedPath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(opts.baseDir, expandedPath);

    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        path: resolvedPath
      };
    }

    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      path: resolvedPath
    };
  } catch (error) {
    const err = error as Error;
    return {
      exists: false,
      isFile: false,
      isDirectory: false,
      path: filePath,
      error: err.message
    };
  }
}

/**
 * Get project name from `src`
 * e.g., "crm/frontend/services/shell" -> "shell"
 * e.g., "github.com/<owner>/<repo>" -> "<repo>"
 * e.g., "arc://junk/user/project" -> "project"
 */
export function getProjectName(src: string | undefined): string {
  if (!src) return 'unknown';

  // Handle arc:// URLs
  if (src.startsWith('arc://')) {
    const pathPart = src.replace('arc://', '');
    return path.basename(pathPart);
  }

  // Handle GitHub URLs
  if (src.includes('github.com/')) {
    const match = src.match(/github\.com\/[^/]+\/([^/]+)/);
    if (match) {
      return match[1].replace('.git', '');
    }
  }

  // Handle regular paths
  return path.basename(src);
}

export function resolveProjectSrcToWorkspacePath(workspaceRoot: string, projectSrc: string | undefined): string | null {
  if (!projectSrc || typeof projectSrc !== 'string') return null;
  // Treat relative paths as relative to the workspace root (not project root).
  return path.isAbsolute(projectSrc) ? projectSrc : path.resolve(workspaceRoot, projectSrc);
}

export function isExistingDirectory(dirPath: string | null | undefined): dirPath is string {
  try {
    if (!dirPath) return false;
    if (!fs.existsSync(dirPath)) return false;
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create symlink in projects/ pointing directly to a target folder.
 * Used for local-folder projects (project.src is a directory path).
 */
export function createProjectSymlinkToTarget(
  projectsDir: string,
  projectName: string,
  targetPath: string,
  log: (message: string) => void
): SymlinkResult {
  const symlinkPath = path.join(projectsDir, projectName);
  const resolvedTarget = path.resolve(targetPath);

  try {
    // Check if symlink already exists
    if (fs.existsSync(symlinkPath)) {
      if (fs.lstatSync(symlinkPath).isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(symlinkPath);
        // readlink may return relative paths; normalize before comparing
        const existingResolved = path.resolve(path.dirname(symlinkPath), existingTarget);
        if (existingResolved === resolvedTarget) {
          log(`Symlink already exists and points to correct target: ${symlinkPath} -> ${resolvedTarget}`);
          return { success: true, path: symlinkPath, target: resolvedTarget, existed: true };
        }
        fs.unlinkSync(symlinkPath);
        log(`Removed old symlink: ${symlinkPath} (was pointing to ${existingTarget})`);
      } else {
        // It's a directory or file, remove it
        fs.rmSync(symlinkPath, { recursive: true, force: true });
        log(`Removed existing path: ${symlinkPath}`);
      }
    }

    if (!fs.existsSync(resolvedTarget)) {
      log(`Target path does not exist: ${resolvedTarget}`);
      return { success: false, path: symlinkPath, target: resolvedTarget, error: 'Target path does not exist' };
    }

    const stats = fs.statSync(resolvedTarget);
    if (!stats.isDirectory()) {
      log(`Target path is not a directory: ${resolvedTarget}`);
      return { success: false, path: symlinkPath, target: resolvedTarget, error: 'Target path is not a directory' };
    }

    fs.symlinkSync(resolvedTarget, symlinkPath);
    log(`Created symlink: ${symlinkPath} -> ${resolvedTarget}`);
    return { success: true, path: symlinkPath, target: resolvedTarget, created: true };
  } catch (error) {
    const err = error as Error;
    log(`Error creating symlink: ${err.message}`);
    return { success: false, path: symlinkPath, target: resolvedTarget, error: err.message };
  }
}

/**
 * Create symlink for a project into an Arcadia checkout.
 */
export function createProjectSymlink(
  projectsDir: string,
  projectName: string,
  pathInArcadia: string,
  env: Record<string, string>,
  log: (message: string) => void
): SymlinkResult {
  const symlinkPath = path.join(projectsDir, projectName);

  // Get ARCADIA path from env
  let arcadiaPath = env.ARCADIA || process.env.ARCADIA || '~/arcadia';
  arcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');

  const targetPath = path.join(arcadiaPath, pathInArcadia);

  try {
    // Check if symlink already exists
    if (fs.existsSync(symlinkPath)) {
      // Check if it's a symlink
      if (fs.lstatSync(symlinkPath).isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(symlinkPath);
        if (existingTarget === targetPath) {
          log(`Symlink already exists and points to correct target: ${symlinkPath} -> ${targetPath}`);
          return { success: true, path: symlinkPath, target: targetPath, existed: true };
        }

        // Remove old symlink
        fs.unlinkSync(symlinkPath);
        log(`Removed old symlink: ${symlinkPath} (was pointing to ${existingTarget})`);
      } else {
        // It's a directory, remove it
        fs.rmSync(symlinkPath, { recursive: true, force: true });
        log(`Removed existing directory: ${symlinkPath}`);
      }
    }

    // Check if target exists
    if (!fs.existsSync(targetPath)) {
      log(`Target path does not exist: ${targetPath}`);
      return { success: false, path: symlinkPath, target: targetPath, error: 'Target path does not exist' };
    }

    // Create symlink
    fs.symlinkSync(targetPath, symlinkPath);
    log(`Created symlink: ${symlinkPath} -> ${targetPath}`);

    return { success: true, path: symlinkPath, target: targetPath, created: true };
  } catch (error) {
    const err = error as Error;
    log(`Error creating symlink: ${err.message}`);
    return { success: false, path: symlinkPath, target: targetPath, error: err.message };
  }
}

/**
 * Check if test string is an HTTP request (format: "GET https://..." or "POST https://...")
 */
export function isHttpRequest(test: string | undefined): boolean {
  if (!test) return false;
  const trimmed = test.trim();
  return /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+https?:\/\//i.test(trimmed);
}

export function isSafeRelativePath(p: string): boolean {
  const normalized = path.normalize(p);
  if (!normalized || normalized.trim() === '') return false;
  if (path.isAbsolute(normalized)) return false;
  // Block path traversal outside the base directory/workspace root
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return false;
  return true;
}

export function copyPathRecursiveSync(srcPath: string, destPath: string): void {
  const st = fs.lstatSync(srcPath);
  // Skip special files (sockets/FIFOs) which cannot be copied.
  if (st.isSocket?.() || st.isFIFO?.()) return;
  if (st.isSymbolicLink()) {
    const link = fs.readlinkSync(srcPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try {
      fs.unlinkSync(destPath);
    } catch {
      // ignore
    }
    fs.symlinkSync(link, destPath);
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    const entries = fs.readdirSync(srcPath, { withFileTypes: true });
    for (const entry of entries) {
      copyPathRecursiveSync(path.join(srcPath, entry.name), path.join(destPath, entry.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

export function copySeedFilesFromProvidedWorkspaceConfig(params: {
  workspaceRoot: string;
  providedWorkspaceConfigPath: string;
  seedFiles: unknown;
  print: InstallerPrinter;
  symbols: InstallerSymbols;
  log: (message: string) => void;
}): void {
  const { workspaceRoot, providedWorkspaceConfigPath, seedFiles, print, symbols, log } = params;

  if (!Array.isArray(seedFiles) || seedFiles.length === 0) return;

  const sourceRoot = path.dirname(providedWorkspaceConfigPath);

  print(`\n${symbols.info} Copying seed files into workspace...`, 'cyan');
  log(`Copying ${seedFiles.length} seed file(s) from ${sourceRoot} into ${workspaceRoot}`);

  for (const entry of seedFiles) {
    if (typeof entry !== 'string') {
      print(`  ${symbols.warning} Skipping non-string entry in seedFiles[]`, 'yellow');
      log(`Skipping non-string entry in seedFiles[]: ${JSON.stringify(entry)}`);
      continue;
    }

    const relPath = entry.trim();
    if (!isSafeRelativePath(relPath)) {
      print(`  ${symbols.warning} Skipping unsafe path in seedFiles[]: ${entry}`, 'yellow');
      log(`Skipping unsafe path in seedFiles[]: ${entry}`);
      continue;
    }

    const srcPath = path.join(sourceRoot, relPath);
    const destPath = path.join(workspaceRoot, relPath);

    try {
      if (!fs.existsSync(srcPath)) {
        print(`  ${symbols.warning} Missing seed path: ${relPath}`, 'yellow');
        log(`Seed path does not exist: ${srcPath}`);
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      copyPathRecursiveSync(srcPath, destPath);
      print(`  ${symbols.success} Copied: ${relPath}`, 'green');
      log(`Copied seed path: ${srcPath} -> ${destPath}`);
    } catch (error) {
      const err = error as Error;
      print(`  ${symbols.warning} Failed to copy ${relPath}: ${err.message}`, 'yellow');
      log(`Failed to copy seed path ${srcPath} -> ${destPath}: ${err.message}`);
    }
  }
}

/**
 * Calculate directory size recursively
 */
export function getDirectorySize(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    let size = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += getDirectorySize(entryPath);
      } else {
        try {
          const fileStats = fs.statSync(entryPath);
          size += fileStats.size;
        } catch {
          // Skip files that can't be accessed.
          continue;
        }
      }
    }

    return size;
  } catch {
    return 0;
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}


