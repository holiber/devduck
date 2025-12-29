import { describe, test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

import { checkMcpServer } from '../../src/install/mcp.js';

const silent = { log: () => {}, print: () => {} };

describe('install/mcp optional servers', () => {
  test('marks optional URL-based server failure as non-blocking', async () => {
    // Create a fast 404 responder to simulate an unreachable MCP endpoint.
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

      assert.strictEqual(result.optional, true);
      assert.strictEqual(result.working, false);
      assert.ok(result.error?.includes('404'));
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

    assert.strictEqual(result.optional, true);
    assert.strictEqual(result.working, false);
    assert.ok(result.error?.toLowerCase().includes('command'));
  });
});

