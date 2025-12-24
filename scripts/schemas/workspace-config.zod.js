/**
 * Zod schema for `workspace.config.json`.
 *
 * Notes:
 * - This repo currently reads the config via ad-hoc `JSON.parse` in several scripts.
 * - The schema is primarily for documentation / shared shape / defensive parsing.
 * - Keep the schema permissive via `.passthrough()` so new fields don't break consumers.
 */
const { z } = require('zod');

/**
 * `env[]` entries used to generate the workspace `.env` file.
 *
 * Supported key aliases (kept for backward compatibility):
 * - name | key
 * - default | value
 * - description | comment
 */
const WorkspaceEnvVarSchema = z
  .object({
    name: z.string().optional(),
    key: z.string().optional(),

    default: z.string().optional(),
    value: z.string().optional(),

    description: z.string().optional(),
    comment: z.string().optional(),
  })
  .passthrough()
  .refine((v) => typeof v.name === 'string' || typeof v.key === 'string', {
    message: 'env items must have `name` (or legacy `key`)',
  });

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
 *
 * Supported key aliases:
 * - src (preferred)
 * - path_in_arcadia (legacy)
 */
const WorkspaceProjectSchema = z
  .object({
    src: z.string().optional(),
    path_in_arcadia: z.string().optional(),
    checks: z.array(WorkspaceCheckSchema).optional(),
  })
  .passthrough()
  .refine((p) => typeof p.src === 'string' || typeof p.path_in_arcadia === 'string', {
    message: 'project items must have `src` or legacy `path_in_arcadia`',
  });

const WorkspaceConfigSchema = z
  .object({
    workspaceVersion: z.string(),
    devduckPath: z.string().optional(),

    // Module selection: explicit module list or ["*"] to mean “all available modules”.
    modules: z.array(z.string()).optional(),
    // Per-module override settings. Merge behavior is implemented in module resolver.
    moduleSettings: z.record(z.string(), z.any()).optional(),

    // External module repositories to load (git / arcadia formats).
    repos: z.array(z.string()).optional(),

    // Workspace projects (Arcadia, GitHub/Git, local folders).
    projects: z.array(WorkspaceProjectSchema).optional(),

    // Workspace-level checks (also used to generate `.cursor/mcp.json` via mcpSettings).
    checks: z.array(WorkspaceCheckSchema).optional(),

    // Variables written into `.env`.
    env: z.array(WorkspaceEnvVarSchema).optional(),
  })
  .passthrough();

module.exports = {
  WorkspaceConfigSchema,
  WorkspaceProjectSchema,
  WorkspaceCheckSchema,
  WorkspaceEnvVarSchema,
  McpServerSettingsSchema,
};

