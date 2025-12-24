/**
 * Zod schema for workspace.config.json
 *
 * This schema validates the workspace configuration file structure.
 * Fields are kept optional/loose where the system is still evolving.
 */

const { z } = require('zod');

const WorkspaceConfigSchema = z
  .object({
    workspaceVersion: z.string().optional(),
    devduckPath: z.string().optional(),
    modules: z.array(z.string()).optional(),
    moduleSettings: z.record(z.any()).optional(),
    repos: z.array(z.string()).optional(),
    projects: z.array(z.any()).optional(),
    importScripts: z.array(z.string()).optional(),
    checks: z.array(z.any()).optional(),
    env: z.array(z.any()).optional(),
  })
  .passthrough();

module.exports = {
  WorkspaceConfigSchema,
};

