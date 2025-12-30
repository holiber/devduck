import net from 'net';
import { TRPC_ERROR_CODES_BY_KEY, type TRPCRequestMessage, type TRPCResponse } from '@trpc/server/rpc';
import path from 'path';
import type { BarducksService } from '../BarducksService.js';
import { safeUnlinkSync, ensureDirSync } from '../fs-utils.js';
import { appRouter } from '../router.js';

function toTRPCErrorResponse(id: TRPCRequestMessage['id'], err: unknown): TRPCResponse<never> & { id: TRPCRequestMessage['id'] } {
  const e = err as { message?: string; stack?: string; code?: string };
  const message = e?.message || String(err);
  return {
    id,
    error: {
      code: TRPC_ERROR_CODES_BY_KEY.INTERNAL_SERVER_ERROR,
      message,
      data: {
        code: 'INTERNAL_SERVER_ERROR',
        stack: e?.stack
      }
    }
  };
}

export function startBarducksIpcServer(params: {
  socketPath: string;
  service: BarducksService;
}): net.Server {
  ensureDirSync(path.dirname(params.socketPath));
  safeUnlinkSync(params.socketPath);

  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', async chunk => {
      buffer += chunk;
      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        let msg: TRPCRequestMessage;
        try {
          msg = JSON.parse(line) as TRPCRequestMessage;
        } catch (err) {
          socket.write(JSON.stringify(toTRPCErrorResponse(null, err)) + '\n');
          // Ensure client doesn't hang waiting for an id-matched response.
          socket.end();
          return;
        }

        const id = msg.id ?? null;
        try {
          const caller = appRouter.createCaller({ service: params.service }) as any as Record<string, any>;
          const pathParts = String((msg as any).params?.path ?? '').split('.').filter(Boolean);
          const input = (msg as any).params?.input;

          let fn: any = caller;
          for (const part of pathParts) {
            fn = fn?.[part];
          }
          if (typeof fn !== 'function') {
            throw new Error(`Unknown procedure path: ${(msg as any).params?.path}`);
          }

          const data = await fn(input);
          const resp: TRPCResponse<unknown> & { id: typeof id } = {
            id,
            result: { type: 'data', data }
          };
          socket.write(JSON.stringify(resp) + '\n');
        } catch (err) {
          socket.write(JSON.stringify(toTRPCErrorResponse(id, err)) + '\n');
        }
      }
    });
  });

  server.listen(params.socketPath);
  return server;
}

