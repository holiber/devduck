import { z } from 'zod';
import { readJsonIfExistsSync, writeJsonAtomicSync } from './fs-utils.js';

export const ProcessSpecSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional().default({})
});

export type ProcessSpec = z.infer<typeof ProcessSpecSchema>;

export const ProcessRecordSchema = z.object({
  name: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  outLogPath: z.string().min(1),
  errLogPath: z.string().min(1)
});

export type ProcessRecord = z.infer<typeof ProcessRecordSchema>;

export const ServiceSessionSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  baseURL: z.string().optional(),
  processes: z.array(ProcessRecordSchema)
});

export type ServiceSession = z.infer<typeof ServiceSessionSchema>;

export function createEmptySession(): ServiceSession {
  const now = new Date().toISOString();
  return { version: 1, createdAt: now, updatedAt: now, processes: [] };
}

export function loadSession(sessionPath: string): ServiceSession {
  const raw = readJsonIfExistsSync<unknown>(sessionPath);
  if (!raw) return createEmptySession();
  const parsed = ServiceSessionSchema.safeParse(raw);
  if (!parsed.success) return createEmptySession();
  return parsed.data;
}

export function saveSession(sessionPath: string, session: ServiceSession): void {
  const updated: ServiceSession = { ...session, updatedAt: new Date().toISOString() };
  writeJsonAtomicSync(sessionPath, updated);
}

