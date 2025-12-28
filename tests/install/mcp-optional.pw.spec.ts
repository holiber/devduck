import { test, expect } from '@playwright/test';
import http from 'node:http';

import { checkMcpServer } from '../../scripts/install/mcp.ts';

const silent = { log: () => {}, print: () => {} };

test.describe('install/mcp optional servers', () => {
  test('marks optional URL-based server failure as non-blocking', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });

    let port = 0;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          port = address.port;
        }
        resolve();
      });
    });

    try {
      const result = await checkMcpServer(
        'devtools-mcp',
        { url: `http://127.0.0.1:${port}/missing`, optional: true },
        silent
      );

      expect(result.optional).toBe(true);
      expect(result.working).toBe(false);
      expect(result.error ?? '').toContain('404');
    } finally {
      server.close();
    }
  });

  test('marks optional command-based server failure as non-blocking', async () => {
    const result = await checkMcpServer(
      'devtools-mcp',
      { command: 'definitely-not-a-real-command-xyz', optional: true },
      silent
    );

    expect(result.optional).toBe(true);
    expect(result.working).toBe(false);
    expect((result.error ?? '').toLowerCase()).toContain('command');
  });
});

