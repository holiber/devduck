import { initTRPC } from '@trpc/server';
import type { DevduckService } from './DevduckService.js';

export type DevduckServiceContext = {
  service: DevduckService;
};

export const t = initTRPC.context<DevduckServiceContext>().create();

