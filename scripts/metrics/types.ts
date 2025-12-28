/**
 * Types for CI metrics collection
 */

export interface PRMetrics {
  /** Timestamp of metrics collection */
  timestamp: string;
  /** Code changes: lines added */
  additions?: number;
  /** Code changes: lines deleted */
  deletions?: number;
  /** Build time in seconds */
  buildTimeSec?: number;
  /** Dev mode startup time in seconds */
  devStartTimeSec?: number;
  /** Bundle size in bytes */
  bundleSizeBytes?: number;
  /** Page load times for monitored pages */
  pageLoadTimes?: Record<string, number>;
  /** Test execution summary */
  tests?: TestSummary;
  /** Git commit SHA */
  commitSha?: string;
  /** PR number if applicable */
  prNumber?: number;
  /** Branch name */
  branch?: string;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface AIAgentLog {
  /** Unique log ID */
  id: string;
  /** Agent type: cursor, claude, gpt, etc */
  agent: string;
  /** Session/conversation ID if available */
  sessionId?: string;
  /** Timestamp when log was created */
  timestamp: string;
  /** Summary of what the agent did */
  summary: string;
  /** Duration of the agent session in seconds */
  durationSec?: number;
  /** Files that were modified */
  filesModified?: string[];
  /** Number of prompts/messages in the session */
  messageCount?: number;
  /** Token usage if available */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** Raw log data (for debugging) */
  rawData?: unknown;
}

export interface MetricsConfig {
  /** Directory for metrics output (default: .cache/metrics) */
  metricsDir: string;
  /** Directory for logs (default: .cache/logs) */
  logsDir: string;
  /** Directory for AI agent logs (default: .cache/ai_logs) */
  aiLogsDir: string;
  /** Directory for Playwright artifacts (default: .cache/playwright) */
  playwrightDir: string;
}

export const DEFAULT_CONFIG: MetricsConfig = {
  metricsDir: '.cache/metrics',
  logsDir: '.cache/logs',
  aiLogsDir: '.cache/ai_logs',
  playwrightDir: '.cache/playwright',
};
