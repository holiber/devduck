/**
 * Abstract base class for repository operations
 * 
 * This class defines the interface for working with different types of repositories
 * (Git, arc working copy, etc.). Subclasses must implement all abstract methods.
 */

export interface RepoStats {
  ok: boolean;
  exists?: boolean;
  hasChanges?: boolean;
  hasUnpushedCommits?: boolean;
  currentBranch?: string | null;
  commits?: Array<{ hash: string; message: string }>;
  unpushedCommits?: Array<{ hash: string; message: string }>;
  files?: Array<{ file: string; status: string; statusName?: string }>;
  error?: string;
}

export interface DiffResult {
  ok: boolean;
  diff?: string;
  baseBranch?: string;
  error?: string;
}

export interface ChangedFilesResult {
  ok: boolean;
  files: Array<{ status: string; file: string }>;
  error?: string | null;
}

export interface CommitsResult {
  ok: boolean;
  commits: Array<{ hash: string; message: string }>;
  error?: string | null;
}

export interface BranchResult {
  ok: boolean;
  branch: string | null;
  error?: string;
}

export interface PRStatusResult {
  exists: boolean;
  pr: {
    id: number;
    url: string;
    title: string;
  } | null;
  error?: string;
}

export interface CreatePRResult {
  ok: boolean;
  url: string | null;
  method?: string;
  error?: string;
}

export interface BranchExistsResult {
  ok: boolean;
  exists: boolean;
  error?: string;
}

export abstract class Repo {
  protected repoPath: string;
  protected options: Record<string, unknown>;

  /**
   * @param repoPath - Path to the repository
   * @param options - Additional options for repository operations
   */
  constructor(repoPath: string, options: Record<string, unknown> = {}) {
    this.repoPath = repoPath;
    this.options = options;
  }

  /**
   * Get repository status (changed files, current branch, commits)
   * @returns Status object with hasChanges, files, currentBranch, commits, etc.
   */
  abstract stats(): Promise<RepoStats>;

  /**
   * Get diff content relative to base branch
   * @param baseBranch - Base branch to compare against
   * @returns Object with ok, diff, error fields
   */
  abstract diff(baseBranch?: string): Promise<DiffResult>;

  /**
   * Get list of changed files relative to base branch
   * @param baseBranch - Base branch to compare against
   * @returns Object with ok, files array, error fields
   */
  abstract getChangedFiles(baseBranch?: string): Promise<ChangedFilesResult>;

  /**
   * Get list of commits relative to base branch
   * @param baseBranch - Base branch to compare against
   * @returns Object with ok, commits array, error fields
   */
  abstract getCommits(baseBranch?: string): Promise<CommitsResult>;

  /**
   * Get current branch name
   * @returns Object with ok, branch, error fields
   */
  abstract getCurrentBranch(): Promise<BranchResult>;

  /**
   * Get base branch name (main/master for Git, trunk for arc working copy)
   * @returns Object with ok, branch, error fields
   */
  abstract getBaseBranch(): Promise<BranchResult>;

  /**
   * Check if PR exists for the given branch
   * @param branch - Branch name to check
   * @returns Object with exists, pr (if exists), error fields
   */
  abstract getPRStatus(branch: string): Promise<PRStatusResult>;

  /**
   * Create a pull request
   * @param branch - Branch name for the PR
   * @param title - PR title
   * @param description - PR description
   * @returns Object with ok, url, error fields
   */
  abstract createPR(branch: string, title: string, description: string): Promise<CreatePRResult>;

  /**
   * Check if branch exists
   * @param branchName - Branch name to check
   * @returns Object with ok, exists, error fields
   */
  abstract branchExists(branchName: string): Promise<BranchExistsResult>;
}

