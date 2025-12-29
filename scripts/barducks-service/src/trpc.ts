import { initTRPC } from '@trpc/server';
import type { BarducksService } from './BarducksService.js';

export type DevduckServiceContext = {
  service: BarducksService;
};

export const t = initTRPC.context<DevduckServiceContext>().create();

