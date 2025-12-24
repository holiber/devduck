/**
 * Abstract base class for CI operations
 * 
 * This class defines the interface for working with different CI systems
 * (GitHub Actions, Arcadia CI, etc.). Subclasses must implement all abstract methods.
 */

export interface CISetupOptions {
  testCommand?: string;
  baseBranch?: string;
  [key: string]: unknown;
}

export interface CISetupResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface CICheckResult {
  ok: boolean;
  checks: Array<{
    name: string;
    status: string;
    [key: string]: unknown;
  }>;
  summary?: string;
  error?: string;
}

export interface Repo {
  [key: string]: unknown;
}

export abstract class CI {
  protected repo: Repo;
  protected options: Record<string, unknown>;

  /**
   * @param repo - Repository instance (GitRepo, ArcRepo, etc.)
   * @param options - Additional options for CI operations
   */
  constructor(repo: Repo, options: Record<string, unknown> = {}) {
    this.repo = repo;
    this.options = options;
  }

  /**
   * Setup CI configuration (create workflow files, configuration, etc.)
   * @param options - Setup options (testCommand, baseBranch, etc.)
   * @returns Object with ok, path, error fields
   */
  abstract setup(options?: CISetupOptions): Promise<CISetupResult>;

  /**
   * Check merge checks status (CI status for PR/branch)
   * @param branchOrPR - Branch name or PR object
   * @returns Object with ok, checks array, summary, error fields
   */
  abstract checkMergeChecks(branchOrPR: string | Record<string, unknown>): Promise<CICheckResult>;
}

