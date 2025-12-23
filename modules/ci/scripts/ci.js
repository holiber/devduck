/**
 * Abstract base class for CI operations
 * 
 * This class defines the interface for working with different CI systems
 * (GitHub Actions, Arcadia CI, etc.). Subclasses must implement all abstract methods.
 */

class CI {
  /**
   * @param {Repo} repo - Repository instance (GitRepo, ArcRepo, etc.)
   * @param {object} options - Additional options for CI operations
   */
  constructor(repo, options = {}) {
    this.repo = repo;
    this.options = options;
  }

  /**
   * Setup CI configuration (create workflow files, configuration, etc.)
   * @param {object} options - Setup options (testCommand, baseBranch, etc.)
   * @returns {Promise<object>} Object with ok, path, error fields
   */
  async setup(options = {}) {
    throw new Error('setup() must be implemented by subclass');
  }

  /**
   * Check merge checks status (CI status for PR/branch)
   * @param {string|object} branchOrPR - Branch name or PR object
   * @returns {Promise<object>} Object with ok, checks array, summary, error fields
   */
  async checkMergeChecks(branchOrPR) {
    throw new Error('checkMergeChecks() must be implemented by subclass');
  }
}

module.exports = CI;

