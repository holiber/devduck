import fs from 'fs';
import path from 'path';
import { findWorkspaceRoot } from '../../../src/lib/workspace-root.js';
import type { ResourceMetadata } from '../schemas/contract.js';

export interface ResourcesJson {
  [resourceId: string]: ResourceMetadata;
}

/**
 * Get the cache directory for issues
 */
export function getIssuesCacheDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.cache', 'issues');
}

/**
 * Get the cache directory for a specific issue
 */
export function getIssueCacheDir(workspaceRoot: string, issueId: string): string {
  return path.join(getIssuesCacheDir(workspaceRoot), sanitizeIssueId(issueId));
}

/**
 * Get the resources directory for a specific issue
 */
export function getIssueResourcesDir(workspaceRoot: string, issueId: string): string {
  return path.join(getIssueCacheDir(workspaceRoot, issueId), 'resources');
}

/**
 * Get the resources.json path for a specific issue
 */
export function getResourcesJsonPath(workspaceRoot: string, issueId: string): string {
  return path.join(getIssueCacheDir(workspaceRoot, issueId), 'resources.json');
}

/**
 * Sanitize issue ID for use in file paths
 */
export function sanitizeIssueId(issueId: string): string {
  // Replace invalid characters with underscores
  return issueId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Ensure issue cache directory structure exists
 */
export function ensureIssueCacheDir(workspaceRoot: string, issueId: string): {
  issueDir: string;
  resourcesDir: string;
  resourcesJsonPath: string;
} {
  const issueDir = getIssueCacheDir(workspaceRoot, issueId);
  const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);
  const resourcesJsonPath = getResourcesJsonPath(workspaceRoot, issueId);

  // Create directories if they don't exist
  fs.mkdirSync(resourcesDir, { recursive: true });

  return { issueDir, resourcesDir, resourcesJsonPath };
}

/**
 * Read resources.json file
 */
export function readResourcesJson(workspaceRoot: string, issueId: string): ResourcesJson {
  const resourcesJsonPath = getResourcesJsonPath(workspaceRoot, issueId);
  if (!fs.existsSync(resourcesJsonPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(resourcesJsonPath, 'utf8');
    return JSON.parse(content) as ResourcesJson;
  } catch (error) {
    // If file is corrupted, return empty object
    return {};
  }
}

/**
 * Write resources.json file
 */
export function writeResourcesJson(
  workspaceRoot: string,
  issueId: string,
  resources: ResourcesJson
): void {
  const resourcesJsonPath = getResourcesJsonPath(workspaceRoot, issueId);
  fs.writeFileSync(resourcesJsonPath, JSON.stringify(resources, null, 2) + '\n', 'utf8');
}

/**
 * Update a single resource in resources.json
 */
export function updateResourceMetadata(
  workspaceRoot: string,
  issueId: string,
  resourceId: string,
  metadata: ResourceMetadata
): void {
  const resources = readResourcesJson(workspaceRoot, issueId);
  resources[resourceId] = metadata;
  writeResourcesJson(workspaceRoot, issueId, resources);
}

/**
 * Get resource file path within resources directory
 */
export function getResourceFilePath(resourcesDir: string, resourcePath: string): string {
  // Ensure resourcePath is relative to resources directory
  const normalizedPath = path.normalize(resourcePath);
  if (path.isAbsolute(normalizedPath)) {
    // If absolute, make it relative to resourcesDir
    return path.join(resourcesDir, path.basename(normalizedPath));
  }
  return path.join(resourcesDir, normalizedPath);
}

/**
 * Save resource file to resources directory
 */
export function saveResourceFile(
  resourcesDir: string,
  resourcePath: string,
  content: string | Buffer
): string {
  const filePath = getResourceFilePath(resourcesDir, resourcePath);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Get PRs cache directory
 */
export function getPRsCacheDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.cache', 'prs');
}

/**
 * Get PR cache directory for a specific PR
 */
export function getPRCacheDir(workspaceRoot: string, prId: string): string {
  return path.join(getPRsCacheDir(workspaceRoot), sanitizeIssueId(prId));
}

/**
 * Ensure PR cache directory exists
 */
export function ensurePRCacheDir(workspaceRoot: string, prId: string): string {
  const prDir = getPRCacheDir(workspaceRoot, prId);
  fs.mkdirSync(prDir, { recursive: true });
  return prDir;
}

/**
 * Get workspace root or use current working directory as fallback
 */
export function getWorkspaceRootOrThrow(): string {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  // If workspace root not found, use current working directory (project root)
  return workspaceRoot || process.cwd();
}

/**
 * Clean up resources directory by moving files not in resources.json to trash folder
 */
export function cleanupResourcesDir(workspaceRoot: string, issueId: string): number {
  const resourcesDir = getIssueResourcesDir(workspaceRoot, issueId);
  const trashDir = path.join(resourcesDir, 'trash');
  const resourcesJson = readResourcesJson(workspaceRoot, issueId);

  if (!fs.existsSync(resourcesDir)) {
    return 0;
  }

  // Collect all valid file paths from resources.json
  const validPaths = new Set<string>();
  for (const metadata of Object.values(resourcesJson)) {
    if (metadata.path) {
      // Add the path as-is and also as absolute path
      validPaths.add(metadata.path);
      validPaths.add(path.join(resourcesDir, metadata.path));
    }
  }

  // Always keep issue.json (it's always valid)
  validPaths.add('issue.json');
  validPaths.add(path.join(resourcesDir, 'issue.json'));

  // Create trash directory if needed
  let movedCount = 0;

  try {
    // Read all files in resources directory
    const entries = fs.readdirSync(resourcesDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip directories (including trash itself)
      if (entry.isDirectory()) {
        continue;
      }

      const filePath = path.join(resourcesDir, entry.name);
      const relativePath = entry.name;

      // Skip if file is in valid paths
      if (validPaths.has(relativePath) || validPaths.has(filePath)) {
        continue;
      }

      // Move to trash
      try {
        fs.mkdirSync(trashDir, { recursive: true });
        const trashPath = path.join(trashDir, entry.name);
        fs.renameSync(filePath, trashPath);
        movedCount++;
      } catch (error) {
        // If move fails, log but continue
        console.warn(`Failed to move ${entry.name} to trash: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    // If directory read fails, log but don't throw
    console.warn(`Failed to cleanup resources directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  return movedCount;
}

