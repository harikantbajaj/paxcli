// Benchmark sample: measures /report latency against the server the Paxcli
// harness started (TARGET_URL). Prints one JSON result line to stdout.
const target = process.env.TARGET_URL;
if (!target) {
  console.error('TARGET_URL not set — this script is run by the Paxcli harness');
  process.exit(1);
}

const REQUESTS = 12;
const times = [];
for (let i = 0; i < REQUESTS; i++) {
  const started = performance.now();
  const res = await fetch(`${target}/report`);
  await res.json();
  times.push(performance.now() - started);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(JSON.stringify({ metric: 'report_latency_ms', value: Number(median.toFixed(2)) }));
