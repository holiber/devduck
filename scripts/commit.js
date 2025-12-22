#!/usr/bin/env node

const { executeCommand } = require('./utils');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    autoConfirm: args.includes('-y') || args.includes('--yes')
  };
}

/**
 * Get current branch name
 */
function getCurrentBranch() {
  const result = executeCommand('arc info');
  if (!result.success) {
    return null;
  }
  
  // Parse branch from arc info output
  const branchMatch = result.output.match(/branch:\s*(.+)/i);
  if (branchMatch) {
    return branchMatch[1].trim();
  }
  
  // Fallback: try to get from arc branch
  const branchResult = executeCommand('arc branch --list-names');
  if (branchResult.success) {
    const lines = branchResult.output.split('\n');
    const currentLine = lines.find(line => line.startsWith('*') || line.includes('(current)'));
    if (currentLine) {
      return currentLine.replace(/^\*\s*/, '').replace(/\s*\(current\)/, '').trim();
    }
  }
  
  return 'trunk';
}

/**
 * Get list of changed files
 */
function getChangedFiles() {
  const files = [];
  
  // Get staged changes first
  const diffCachedResult = executeCommand('arc diff --cached --name-status');
  if (diffCachedResult.success && diffCachedResult.output) {
    const diffLines = diffCachedResult.output.split('\n').filter(l => l.trim());
    diffLines.forEach(line => {
      const match = line.match(/^([AMDR])\s+(.+)$/);
      if (match) {
        files.push({
          status: match[1],
          file: match[2].trim()
        });
      }
    });
  }
  
  // Get unstaged and untracked files
  const statusResult = executeCommand('arc status');
  if (!statusResult.success) {
    return files;
  }
  
  const lines = statusResult.output.split('\n');
  let inUnstagedSection = false;
  let inUntrackedSection = false;
  let inStagedSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for section headers
    if (trimmed.includes('Changes not staged for commit:')) {
      inUnstagedSection = true;
      inUntrackedSection = false;
      inStagedSection = false;
      continue;
    }
    
    if (trimmed.includes('Untracked files:')) {
      inUntrackedSection = true;
      inUnstagedSection = false;
      inStagedSection = false;
      continue;
    }
    
    if (trimmed.includes('Changes to be committed:')) {
      inStagedSection = true;
      inUnstagedSection = false;
      inUntrackedSection = false;
      continue;
    }
    
    // Skip empty lines, instructions, and branch info
    if (!trimmed || 
        trimmed.startsWith('(') || 
        trimmed.startsWith('use "arc') ||
        trimmed.startsWith('On branch') ||
        trimmed.startsWith('Your branch') ||
        trimmed.includes('nothing to commit') ||
        trimmed.includes('no changes added')) {
      continue;
    }
    
    // Parse file entries in unstaged/staged sections (format: "modified:    filename" or "deleted:    filename" or "new file:    filename")
    if (inUnstagedSection || inStagedSection) {
      // Match patterns like "modified:    .cursorrules" or "deleted:    file.txt" or "new file:   file.txt"
      const modifiedMatch = trimmed.match(/^modified:\s+(.+)$/);
      const deletedMatch = trimmed.match(/^deleted:\s+(.+)$/);
      const newFileMatch = trimmed.match(/^new file:\s+(.+)$/);
      const renamedMatch = trimmed.match(/^renamed:\s+(.+)$/);
      
      let fileName = null;
      let status = null;
      
      if (modifiedMatch) {
        fileName = modifiedMatch[1].trim();
        status = 'M';
      } else if (deletedMatch) {
        fileName = deletedMatch[1].trim();
        status = 'D';
      } else if (newFileMatch) {
        fileName = newFileMatch[1].trim();
        status = 'A';
      } else if (renamedMatch) {
        fileName = renamedMatch[1].trim();
        status = 'R';
      }
      
      if (fileName && status) {
        // Skip if already in files list
        const existing = files.find(f => f.file === fileName);
        if (!existing) {
          files.push({ status, file: fileName });
        }
      }
      continue;
    }
    
    // Parse untracked files (just file paths, no prefix)
    if (inUntrackedSection) {
      // Check if it looks like a file path (contains / or .)
      if ((trimmed.includes('/') || trimmed.includes('.')) && !trimmed.includes('arc ')) {
        const fileName = trimmed;
        // Skip if already in files list
        const existing = files.find(f => f.file === fileName);
        if (!existing) {
          files.push({
            status: '?',
            file: fileName
          });
        }
      }
    }
  }
  
  return files;
}

/**
 * Get diff summary for generating commit message
 */
function getDiffSummary() {
  const diffResult = executeCommand('arc diff --cached');
  if (!diffResult.success) {
    // Try without --cached
    const diffResult2 = executeCommand('arc diff');
    if (!diffResult2.success) {
      return '';
    }
    return diffResult2.output;
  }
  return diffResult.output;
}

/**
 * Get diff for specific file
 */
function getFileDiff(filePath) {
  const diffResult = executeCommand(`arc diff --cached ${filePath}`);
  if (!diffResult.success) {
    const diffResult2 = executeCommand(`arc diff ${filePath}`);
    if (!diffResult2.success) {
      return '';
    }
    return diffResult2.output;
  }
  return diffResult.output;
}

/**
 * Analyze changes for potential issues
 */
function analyzeChanges(changedFiles, diffSummary) {
  const warnings = [];
  const info = [];
  
  // Check for large number of files
  if (changedFiles.length > 20) {
    warnings.push({
      type: 'too_many_files',
      message: `Large number of changed files (${changedFiles.length}). Consider splitting into multiple commits.`,
      severity: 'medium'
    });
  }
  
  // Check for deleted files
  const deletedFiles = changedFiles.filter(f => f.status === 'D');
  if (deletedFiles.length > 0) {
    info.push({
      type: 'deleted_files',
      message: `${deletedFiles.length} file(s) deleted. Make sure this is intentional.`,
      files: deletedFiles.map(f => f.file)
    });
  }
  
  // Check for configuration files
  const configFiles = changedFiles.filter(f => 
    f.file.includes('config') || 
    f.file.includes('.env') || 
    f.file.includes('package.json') ||
    f.file.includes('yarn.lock') ||
    f.file.includes('package-lock.json')
  );
  if (configFiles.length > 0) {
    warnings.push({
      type: 'config_files',
      message: 'Configuration or dependency files changed. Verify these changes are intentional.',
      files: configFiles.map(f => f.file),
      severity: 'high'
    });
  }
  
  // Check for test files without source changes
  const testFiles = changedFiles.filter(f => 
    f.file.includes('test') || 
    f.file.includes('spec') ||
    f.file.includes('__tests__')
  );
  const sourceFiles = changedFiles.filter(f => 
    !f.file.includes('test') && 
    !f.file.includes('spec') &&
    !f.file.includes('__tests__') &&
    (f.file.endsWith('.js') || f.file.endsWith('.ts') || f.file.endsWith('.py'))
  );
  if (testFiles.length > 0 && sourceFiles.length === 0) {
    info.push({
      type: 'tests_only',
      message: 'Only test files changed. Make sure corresponding source code changes are not missing.'
    });
  }
  
  // Check for source files without tests
  if (sourceFiles.length > 0 && testFiles.length === 0) {
    info.push({
      type: 'no_tests',
      message: 'Source files changed but no test files modified. Consider adding or updating tests.'
    });
  }
  
  // Check for large diff
  if (diffSummary && diffSummary.length > 10000) {
    warnings.push({
      type: 'large_diff',
      message: 'Large diff detected. Review changes carefully before committing.',
      severity: 'medium'
    });
  }
  
  // Check for common patterns in diff
  if (diffSummary) {
    const diffLower = diffSummary.toLowerCase();
    
    // Check for TODO/FIXME comments
    if (diffLower.includes('todo') || diffLower.includes('fixme')) {
      info.push({
        type: 'todo_comments',
        message: 'Diff contains TODO or FIXME comments. Consider addressing them before committing.'
      });
    }
    
    // Check for console.log/debug statements
    if (diffLower.includes('console.log') || diffLower.includes('console.debug')) {
      warnings.push({
        type: 'debug_code',
        message: 'Diff contains console.log or console.debug statements. Remove debug code before committing.',
        severity: 'low'
      });
    }
    
    // Check for commented code
    const commentedCodeMatches = diffSummary.match(/^\+.*\/\/.*(?:function|class|const|let|var|if|for|while)/m);
    if (commentedCodeMatches) {
      info.push({
        type: 'commented_code',
        message: 'Diff may contain commented code. Consider removing unused code.'
      });
    }
  }
  
  // Check for sensitive files
  const sensitiveFiles = changedFiles.filter(f => 
    f.file.includes('.env') || 
    f.file.includes('secret') ||
    f.file.includes('password') ||
    f.file.includes('key') ||
    f.file.includes('token')
  );
  if (sensitiveFiles.length > 0) {
    warnings.push({
      type: 'sensitive_files',
      message: '⚠️  WARNING: Files with potentially sensitive information detected. Review carefully!',
      files: sensitiveFiles.map(f => f.file),
      severity: 'high'
    });
  }
  
  // Check file extensions
  const extensions = new Set();
  changedFiles.forEach(file => {
    const ext = file.file.split('.').pop();
    if (ext && ext.length < 10) {
      extensions.add(ext);
    }
  });
  
  if (extensions.size > 5) {
    info.push({
      type: 'mixed_file_types',
      message: `Changes span multiple file types (${extensions.size} different extensions). Verify all changes are related.`
    });
  }
  
  return { warnings, info };
}

/**
 * Generate commit message based on changes
 */
function generateCommitMessage(changedFiles, diffSummary) {
  if (changedFiles.length === 0) {
    return 'Update files';
  }
  
  // Analyze file changes
  const fileTypes = {
    added: changedFiles.filter(f => f.status === 'A' || f.status === '?').length,
    modified: changedFiles.filter(f => f.status === 'M').length,
    deleted: changedFiles.filter(f => f.status === 'D').length,
    renamed: changedFiles.filter(f => f.status === 'R').length
  };
  
  // Get file extensions to understand what was changed
  const extensions = new Set();
  const fileNames = [];
  
  changedFiles.forEach(file => {
    const ext = file.file.split('.').pop();
    if (ext && ext.length < 6) {
      extensions.add(ext);
    }
    fileNames.push(file.file);
  });
  
  // Generate message based on changes
  const parts = [];
  
  if (fileTypes.added > 0) {
    parts.push(`Add ${fileTypes.added} file${fileTypes.added > 1 ? 's' : ''}`);
  }
  if (fileTypes.modified > 0) {
    parts.push(`Update ${fileTypes.modified} file${fileTypes.modified > 1 ? 's' : ''}`);
  }
  if (fileTypes.deleted > 0) {
    parts.push(`Remove ${fileTypes.deleted} file${fileTypes.deleted > 1 ? 's' : ''}`);
  }
  if (fileTypes.renamed > 0) {
    parts.push(`Rename ${fileTypes.renamed} file${fileTypes.renamed > 1 ? 's' : ''}`);
  }
  
  // Try to infer purpose from file names
  const mainFile = fileNames[0];
  if (mainFile) {
    const fileName = mainFile.split('/').pop();
    if (fileName.includes('test') || fileName.includes('spec')) {
      parts.push('tests');
    } else if (fileName.includes('config')) {
      parts.push('configuration');
    } else if (fileName.includes('readme') || fileName.includes('doc')) {
      parts.push('documentation');
    }
  }
  
  // Analyze diff for more context
  if (diffSummary) {
    const diffLines = diffSummary.split('\n').slice(0, 50); // First 50 lines
    const hasFunction = diffLines.some(line => line.match(/^\s*(function|def|class|const|let|var)\s+/));
    const hasTest = diffSummary.toLowerCase().includes('test') || diffSummary.toLowerCase().includes('spec');
    
    if (hasTest && !parts.some(p => p.includes('test'))) {
      parts.push('tests');
    }
    if (hasFunction && parts.length === 0) {
      parts.push('code changes');
    }
  }
  
  if (parts.length === 0) {
    return 'Update files';
  }
  
  return parts.join(', ');
}

/**
 * Format output for AI agent
 */
function formatOutput(currentBranch, changedFiles, commitMessage, analysis, options = {}) {
  const canCommit = currentBranch !== 'trunk' && currentBranch.toLowerCase() !== 'trunk';
  const hasWarnings = analysis.warnings.length > 0;
  
  // Auto-commit is allowed only if -y flag is passed, no warnings, and can commit
  const autoCommit = options.autoConfirm && canCommit && !hasWarnings && changedFiles.length > 0;
  
  const output = {
    branch: currentBranch,
    canCommit,
    autoCommit,
    files: changedFiles.map(f => ({
      status: f.status,
      file: f.file,
      statusName: f.status === 'A' ? 'added' : f.status === 'M' ? 'modified' : f.status === 'D' ? 'deleted' : f.status === 'R' ? 'renamed' : 'unknown'
    })),
    suggestedMessage: commitMessage,
    warnings: analysis.warnings,
    info: analysis.info,
    summary: {
      totalFiles: changedFiles.length,
      added: changedFiles.filter(f => f.status === 'A' || f.status === '?').length,
      modified: changedFiles.filter(f => f.status === 'M').length,
      deleted: changedFiles.filter(f => f.status === 'D').length,
      renamed: changedFiles.filter(f => f.status === 'R').length
    }
  };
  
  return JSON.stringify(output, null, 2);
}

/**
 * Main function
 */
function main() {
  // Parse command line arguments
  const args = parseArgs();
  
  // Get current branch
  const currentBranch = getCurrentBranch();
  
  if (!currentBranch) {
    const errorOutput = {
      error: 'Failed to get current branch info',
      canCommit: false,
      autoCommit: false
    };
    console.error(JSON.stringify(errorOutput, null, 2));
    process.exit(1);
  }
  
  // Check for changes
  const changedFiles = getChangedFiles();
  
  if (changedFiles.length === 0) {
    const output = {
      branch: currentBranch,
      canCommit: false,
      autoCommit: false,
      files: [],
      message: 'No changes to commit',
      warnings: [],
      info: []
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }
  
  // Get diff summary
  const diffSummary = getDiffSummary();
  
  // Generate commit message
  const commitMessage = generateCommitMessage(changedFiles, diffSummary);
  
  // Analyze changes for warnings
  const analysis = analyzeChanges(changedFiles, diffSummary);
  
  // Format and output
  const output = formatOutput(currentBranch, changedFiles, commitMessage, analysis, args);
  console.log(output);
}

// Run main function
main();
