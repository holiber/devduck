import http from 'node:http';
import { URL } from 'node:url';

export function getTab4() {
  return 'Hello from tab4 - server';
}

const port = Number(process.env.PORT || 3004);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/tab4') {
    const body = getTab4();
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`tab4-server listening on http://localhost:${port}`);
});

