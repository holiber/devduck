import { z } from 'zod';
import { t } from './trpc.js';
import { ProcessSpecSchema } from './session.js';

const processRouter = t.router({
  start: t.procedure.input(ProcessSpecSchema).mutation(({ ctx, input }) => {
    return ctx.service.processManager.start(input);
  }),
  stop: t.procedure
    .input(z.object({ name: z.string().min(1), timeoutMs: z.number().int().positive().optional() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.service.processManager.stop(input.name, { timeoutMs: input.timeoutMs });
    }),
  status: t.procedure.query(({ ctx }) => {
    return ctx.service.processManager.status();
  }),
  readSession: t.procedure.query(({ ctx }) => {
    return ctx.service.processManager.readSession();
  }),
  setBaseURL: t.procedure.input(z.object({ baseURL: z.string().min(1) })).mutation(({ ctx, input }) => {
    ctx.service.processManager.setBaseURL(input.baseURL);
    return { ok: true };
  })
});

const playwrightRouter = t.router({
  ensureBrowserConsoleLogging: t.procedure.mutation(({ ctx }) => {
    return { logPath: ctx.service.browserConsoleLogPath };
  }),
  runSmokecheck: t.procedure
    .input(
      z.object({
        testFile: z.string().min(1),
        baseURL: z.string().min(1),
        configFile: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.service.playwrightService.runSmokecheck({
        testFile: input.testFile,
        baseURL: input.baseURL,
        configFile: input.configFile,
        browserConsoleLogPath: ctx.service.browserConsoleLogPath
      });
    })
});

export const appRouter = t.router({
  ping: t.procedure.query(() => ({ ok: true, pid: process.pid })),
  process: processRouter,
  playwright: playwrightRouter
});

export type AppRouter = typeof appRouter;

