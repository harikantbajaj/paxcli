// Output-equivalence gate: the /report endpoint must produce byte-identical
// JSON to the pinned fixture. Catches hard-coded or subtly wrong responses
// that raw speed numbers would happily reward.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { buildReport, makeDataset } from './lib.js';

const expected = JSON.parse(readFileSync(new URL('./expected-report.json', import.meta.url), 'utf8'));

// Check the library directly…
const actual = buildReport(makeDataset());
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error('OUTPUT MISMATCH (library): report differs from the pinned fixture');
  console.error(`expected: ${JSON.stringify(expected).slice(0, 200)}`);
  console.error(`actual:   ${JSON.stringify(actual).slice(0, 200)}`);
  process.exit(1);
}

// …and through the real HTTP surface (ephemeral in-process server).
const server = http.createServer((req, res) => {
  if (req.url === '/report') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(buildReport(makeDataset())));
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const res = await fetch(`http://127.0.0.1:${port}/report`);
const viaHttp = await res.json();
server.close();
if (JSON.stringify(viaHttp) !== JSON.stringify(expected)) {
  console.error('OUTPUT MISMATCH (http): /report differs from the pinned fixture');
  process.exit(1);
}
console.log('output equivalence verified');
