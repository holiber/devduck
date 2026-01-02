/**
 * Zod schema for the dashboard snapshot produced by `scripts/dashboard-snapshot.js`.
 *
 * This is primarily for convenience and defensive parsing in the TUI.
 */

import { z } from 'zod';

const SnapshotTaskSchema = z
  .object({
    id: z.string(),
    dir: z.string(),
    type: z.string().optional(),
    status: z.string().optional(),
    stage: z.string().nullable().optional(),
    branch: z.string().nullable().optional(),
    lastFetch: z.string().nullable().optional(),
    ticket: z
      .object({
        key: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    lastRun: z
      .object({
        ts: z.string().nullable().optional(),
        event: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        ok: z.boolean().nullable().optional(),
        logPath: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    latestLog: z
      .object({
        file: z.string(),
        path: z.string(),
      })
      .nullable()
      .optional(),
    sp: z
      .object({
        prev: z.number().nullable().optional(),
        curr: z.number().nullable().optional(),
        display: z.string().optional(),
      })
      .optional(),
    readiness: z
      .object({
        prev: z.number().nullable().optional(),
        curr: z.number().nullable().optional(),
        display: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const SnapshotContainerSchema = z
  .object({
    name: z.string(),
    kind: z.string().optional(),
    status: z.string().optional(),
    image: z.string().optional(),
    cpu: z.string().nullable().optional(),
    cpuPct: z.number().nullable().optional(),
    mem: z.string().nullable().optional(),
    netIO: z.string().nullable().optional(),
    blockIO: z.string().nullable().optional(),
  })
  .passthrough();

const SnapshotEventSchema = z
  .object({
    ts: z.string(),
    source: z.string(),
    taskId: z.string().nullable().optional(),
    level: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const DashboardSnapshotSchema = z
  .object({
    version: z.number(),
    generatedAt: z.string(),
    tasksRoot: z.string(),
    queue: z
      .object({
        items: z.array(z.any()).optional(),
        runningTaskId: z.string().nullable().optional(),
        since: z.string().nullable().optional(),
        bg: z
          .object({
            pid: z.number().nullable().optional(),
            running: z.boolean().optional(),
          })
          .optional(),
      })
      .passthrough(),
    prompts: z
      .object({
        ok: z.boolean().optional(),
        counts: z
          .object({
            total: z.number().optional(),
            queued: z.number().optional(),
            processing: z.number().optional(),
            done: z.number().optional(),
            failed: z.number().optional(),
          })
          .optional(),
        items: z.array(z.any()).optional(),
        state: z
          .object({
            runningPromptId: z.string().nullable().optional(),
            since: z.string().nullable().optional(),
          })
          .optional(),
        bg: z
          .object({
            pid: z.number().nullable().optional(),
            running: z.boolean().optional(),
          })
          .optional(),
        error: z.string().optional(),
      })
      .passthrough()
      .optional(),
    taskStats: z
      .object({
        total: z.number(),
        byStatus: z.record(z.string(), z.number()),
      })
      .passthrough(),
    tasks: z.array(SnapshotTaskSchema),
    containers: z.array(SnapshotContainerSchema),
    docker: z
      .object({
        ok: z.boolean(),
        errors: z.array(z.string()).optional(),
      })
      .passthrough(),
    events: z.array(SnapshotEventSchema).optional(),
  })
  .passthrough();

export {
  DashboardSnapshotSchema,
};


