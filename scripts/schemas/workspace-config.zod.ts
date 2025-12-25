/**
 * Zod schema for `workspace.config.json`.
 *
 * Notes:
 * - This repo currently reads the config via ad-hoc `JSON.parse` in several scripts.
 * - The schema is primarily for documentation / shared shape / defensive parsing.
 * - Keep the schema permissive via `.passthrough()` so new fields don't break consumers.
 */
import { z } from 'zod';

/**
 * `env[]` entries used to generate the workspace `.env` file.
 */
const WorkspaceEnvVarSchema = z
  .object({
    name: z.string(),
    default: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

/**
 * MCP server config shape (as written to `.cursor/mcp.json` under `mcpServers[check.name]`).
 *
 * The installer treats this as opaque data besides a few common fields.
 */
const McpServerSettingsSchema = z
  .object({
    // URL-based servers
    url: z.string().optional(),
    // Command-based servers (typically `npx`, `node`, etc.)
    command: z.string().optional(),
    // Optional marker used by installer checks
    optional: z.boolean().optional(),
  })
  .passthrough();

/**
 * A check entry runnable by `scripts/install.js`.
 *
 * `test` supports:
 * - a shell command (default)
 * - an HTTP request string: "GET https://..." / "POST https://..."
 * - a file/directory path (if it looks like a path, installer checks existence)
 *
 * If `mcpSettings` is present and `test` is missing/empty, installer will auto-generate a test.
 */
const WorkspaceCheckSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    test: z.string().optional(),
    install: z.string().optional(),

    tier: z.string().optional(),
    skip: z.boolean().optional(),

    mcpSettings: McpServerSettingsSchema.optional(),
  })
  .passthrough();

/**
 * A project to materialize under `projects/` (symlink / clone).
 */
const WorkspaceProjectSchema = z
  .object({
    src: z.string(),
    checks: z.array(WorkspaceCheckSchema).optional(),
  })
  .passthrough();

/**
 * Workspace "launch" configuration (dev/smokecheck workflows).
 *
 * This is intentionally permissive: launch runners may support additional fields.
 *
 * Current runner behavior:
 * - If `ready.url` is relative (e.g. "/healthz"), it is resolved against `launch.dev.baseURL`.
 */
const LaunchReadySchema = z
  .object({
    type: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const LaunchProcessSchema = z
  .object({
    name: z.string(),
    cwd: z.string().optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    ready: LaunchReadySchema.optional(),
  })
  .passthrough();

const LaunchCommandSchema = z
  .object({
    cwd: z.string().optional(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const LaunchSmokecheckSchema = z
  .union([
    z
      .object({
        testFile: z.string(),
        configFile: z.string().optional(),
      })
      .passthrough(),
    LaunchCommandSchema
  ])
  .optional();

const LaunchDevSchema = z
  .object({
    baseURL: z.string().optional(),
    processes: z.array(LaunchProcessSchema).optional(),
    smokecheck: LaunchSmokecheckSchema,
  })
  .passthrough();

const WorkspaceLaunchSchema = z
  .object({
    dev: LaunchDevSchema.optional(),
  })
  .passthrough();

const WorkspaceConfigSchema = z
  .object({
    workspaceVersion: z.string(),
    devduckPath: z.string().optional(),

    // Seed files/folders to copy into a *new* workspace when creating it via `--workspace-config`.
    // Paths are relative to the folder containing the provided workspace config file.
    seedFiles: z.array(z.string()).optional(),

    // Module selection: explicit module list or ["*"] to mean "all available modules".
    modules: z.array(z.string()).optional(),
    // Per-module override settings. Merge behavior is implemented in module resolver.
    moduleSettings: z.record(z.string(), z.any()).optional(),

    // External module repositories to load (git / arcadia formats).
    repos: z.array(z.string()).optional(),

    // Workspace projects (Arcadia, GitHub/Git, local folders).
    projects: z.array(WorkspaceProjectSchema).optional(),

    // Additional script names to import from projects (default: test, dev, build, start, lint).
    importScripts: z.array(z.string()).optional(),

    // Workspace-level checks (also used to generate `.cursor/mcp.json` via mcpSettings).
    checks: z.array(WorkspaceCheckSchema).optional(),

    // Variables written into `.env`.
    env: z.array(WorkspaceEnvVarSchema).optional(),

    // Declarative dev/smokecheck launch workflows.
    launch: WorkspaceLaunchSchema.optional(),
  })
  .passthrough();

export {
  WorkspaceConfigSchema,
  WorkspaceProjectSchema,
  WorkspaceCheckSchema,
  WorkspaceEnvVarSchema,
  McpServerSettingsSchema,
};
