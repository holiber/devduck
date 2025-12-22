/**
 * Zod schema for `.cache/tasks/<taskId>/task.json`.
 *
 * Notes:
 * - This is primarily for developer convenience (intellisense / shared shape),
 *   not strict validation at runtime yet.
 * - Keep fields optional/loose where the system is still evolving.
 */

const { z } = require('zod');

const IsoDateString = z.string().nullable().optional();

const TaskRunSchema = z
  .object({
    ts: z.string().optional(),
    event: z.string().optional(),
    status: z.string().optional(),
    ok: z.boolean().optional(),
    logPath: z.string().optional(),
    note: z.string().optional(),
    // Allow future metadata
  })
  .passthrough();

const TicketSchema = z
  .object({
    key: z.string().optional(),
    summary: z.string().optional(),
    updatedAt: z.string().optional(),
    description: z.string().optional(),
    status: z.any().optional(),
    statusType: z.any().optional(),
    queue: z.any().optional(),
    type: z.any().optional(),
    priority: z.any().optional(),
    assignee: z.any().optional(),
    comments: z.any().optional(),
  })
  .passthrough();

const EstimatesSchema = z
  .object({
    sp: z.array(z.any()).optional(),
    readiness: z.array(z.any()).optional(),
  })
  .passthrough();

const TaskInputSchema = z
  .object({
    text: z.string().optional(),
  })
  .passthrough();

const TaskStateSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    status: z.string().optional(),
    // `stage` is the workflow stage (recommended to align with plan stages in plan.md)
    stage: z.string().nullable().optional(),

    branch: z.string().nullable().optional(),
    'last-fetch': IsoDateString,

    ticket: TicketSchema.nullable().optional(),
    pr: z.any().nullable().optional(),

    estimates: EstimatesSchema.optional(),
    ai_usage: z.array(z.any()).optional(),
    runs: z.array(TaskRunSchema).optional(),
    children: z.array(z.any()).optional(),

    input: TaskInputSchema.optional(),
  })
  .passthrough();

module.exports = {
  TaskStateSchema,
};


