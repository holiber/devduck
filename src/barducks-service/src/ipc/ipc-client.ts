import net from 'net';
import { createTRPCProxyClient, type TRPCLink, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import path from 'path';
import type { TRPCRequestMessage, TRPCResponse } from '@trpc/server/rpc';
import type { AppRouter } from '../router.js';

export function ipcLink(params: { socketPath: string }): TRPCLink<AppRouter> {
  return () => {
    return ({ op }) =>
      observable(observer => {
        const req: TRPCRequestMessage = {
          id: op.id,
          method: op.type,
          params: {
            path: op.path,
            input: op.input
          }
        };

        const socket = net.createConnection({ path: params.socketPath });
        socket.setEncoding('utf8');

        let buffer = '';
        let done = false;

        const onAbort = () => {
          if (done) return;
          done = true;
          socket.destroy(new Error('Aborted'));
          observer.error?.(TRPCClientError.from(new Error('Aborted')));
        };

        if (op.signal) {
          if (op.signal.aborted) {
            onAbort();
            return () => {};
          }
          op.signal.addEventListener('abort', onAbort, { once: true });
        }

        socket.on('connect', () => {
          socket.write(JSON.stringify(req) + '\n');
        });

        socket.on('data', chunk => {
          if (done) return;
          buffer += chunk;
          while (true) {
            const idx = buffer.indexOf('\n');
            if (idx < 0) break;
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;

            try {
              const resp = JSON.parse(line) as (TRPCResponse<unknown> & { id?: unknown });
              if (resp && (resp as any).id === op.id) {
                done = true;
                socket.end();
                if ('error' in resp && (resp as any).error) {
                  observer.error?.(TRPCClientError.from(resp as any));
                } else {
                  observer.next?.({ result: (resp as any).result });
                  observer.complete?.();
                }
                return;
              }
            } catch (e) {
              done = true;
              socket.destroy();
              observer.error?.(TRPCClientError.from(e as any));
              return;
            }
          }
        });

        socket.on('error', err => {
          if (done) return;
          done = true;
          observer.error?.(TRPCClientError.from(err));
        });

        socket.on('close', () => {
          if (op.signal) op.signal.removeEventListener('abort', onAbort);
          if (!done) {
            done = true;
            const hint =
              `Connection closed by service before responding. ` +
              `Check service logs in ${path.join(process.cwd(), '.cache', 'barducks-service', 'logs')} ` +
              `(service.out.log / service.err.log).`;
            observer.error?.(TRPCClientError.from(new Error(hint)));
          }
        });

        return () => {
          if (op.signal) op.signal.removeEventListener('abort', onAbort);
          if (!done) {
            done = true;
            socket.destroy();
          }
        };
      });
  };
}

export function createBarducksServiceClient(params: { socketPath: string }) {
  return createTRPCProxyClient<AppRouter>({
    links: [ipcLink({ socketPath: params.socketPath })]
  });
}

