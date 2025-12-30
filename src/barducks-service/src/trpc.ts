import { initTRPC } from '@trpc/server';
import type { BarducksService } from './BarducksService.js';

export type BarducksServiceContext = {
  service: BarducksService;
};

export const t = initTRPC.context<BarducksServiceContext>().create();

