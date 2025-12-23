/**
 * Abstract base class for repository operations
 * 
 * This class defines the interface for working with different types of repositories
 * (Git, Arcadia, etc.). Subclasses must implement all abstract methods.
 */

class Repo {
  /**
   * @param {string} repoPath - Path to the repository
   * @param {object} options - Additional options for repository operations
   */
  constructor(repoPath, options = {}) {
    this.repoPath = repoPath;
    this.options = options;
  }

  /**
   * Get repository status (changed files, current branch, commits)
   * @returns {Promise<object>} Status object with hasChanges, files, currentBranch, commits, etc.
   */
  async stats() {
    throw new Error('stats() must be implemented by subclass');
  }

  /**
   * Get diff content relative to base branch
   * @param {string} baseBranch - Base branch to compare against
   * @returns {Promise<object>} Object with ok, diff, error fields
   */
  async diff(baseBranch) {
    throw new Error('diff() must be implemented by subclass');
  }

  /**
   * Get list of changed files relative to base branch
   * @param {string} baseBranch - Base branch to compare against
   * @returns {Promise<object>} Object with ok, files array, error fields
   */
  async getChangedFiles(baseBranch) {
    throw new Error('getChangedFiles() must be implemented by subclass');
  }

  /**
   * Get list of commits relative to base branch
   * @param {string} baseBranch - Base branch to compare against
   * @returns {Promise<object>} Object with ok, commits array, error fields
   */
  async getCommits(baseBranch) {
    throw new Error('getCommits() must be implemented by subclass');
  }

  /**
   * Get current branch name
   * @returns {Promise<object>} Object with ok, branch, error fields
   */
  async getCurrentBranch() {
    throw new Error('getCurrentBranch() must be implemented by subclass');
  }

  /**
   * Get base branch name (main/master for Git, trunk for Arcadia)
   * @returns {Promise<object>} Object with ok, branch, error fields
   */
  async getBaseBranch() {
    throw new Error('getBaseBranch() must be implemented by subclass');
  }

  /**
   * Check if PR exists for the given branch
   * @param {string} branch - Branch name to check
   * @returns {Promise<object>} Object with exists, pr (if exists), error fields
   */
  async getPRStatus(branch) {
    throw new Error('getPRStatus() must be implemented by subclass');
  }

  /**
   * Create a pull request
   * @param {string} branch - Branch name for the PR
   * @param {string} title - PR title
   * @param {string} description - PR description
   * @returns {Promise<object>} Object with ok, url, error fields
   */
  async createPR(branch, title, description) {
    throw new Error('createPR() must be implemented by subclass');
  }

  /**
   * Check if branch exists
   * @param {string} branchName - Branch name to check
   * @returns {Promise<object>} Object with ok, exists, error fields
   */
  async branchExists(branchName) {
    throw new Error('branchExists() must be implemented by subclass');
  }
}

module.exports = Repo;

