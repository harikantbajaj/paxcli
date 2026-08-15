import http from 'node:http';
import { buildReport, makeDataset } from './lib.js';

const port = Number(process.env.PORT ?? 3000);
const dataset = makeDataset();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/report') {
    const report = buildReport(dataset);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(report));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`demo-api listening on ${port}`);
});
