import http from 'node:http';
import { URL } from 'node:url';

export function getTab4(): string {
  return 'Hello from tab4 - server';
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(json));
  // Basic CORS so the SPA can call the API if needed.
  res.setHeader('access-control-allow-origin', '*');
  res.end(json);
}

function sendText(res: http.ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.setHeader('access-control-allow-origin', '*');
  res.end(body);
}

const port = Number(process.env.PORT || 4010);
const host = '127.0.0.1';

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${host}:${port}`);

  if (method === 'GET' && url.pathname === '/healthz') {
    sendText(res, 200, 'ok');
    return;
  }

  if (method === 'GET' && url.pathname === '/api/tab4') {
    sendJson(res, 200, { message: getTab4() });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`SERVER_READY http://${host}:${port}`);
});

