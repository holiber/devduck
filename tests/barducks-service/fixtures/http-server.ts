import http from 'http';

const port = Number(process.env.PORT || '0');
if (!port) {
  // eslint-disable-next-line no-console
  console.error('Missing PORT');
  process.exit(1);
}

const server = http.createServer((_req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<html><body><h1>ok</h1></body></html>');
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`SERVER_READY http://127.0.0.1:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 250).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

