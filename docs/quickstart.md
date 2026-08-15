# Quickstart

## 1. Watch the demo (no setup)

```bash
npx paxcli demo
```

Two reward hacks get rejected in front of you; a real fix gets accepted with a Verification Card.

## 2. Prepare your repository

You need:
- a git repo with at least one commit,
- a test command that exits non-zero on failure,
- a benchmark: a command that measures once and prints one JSON line to stdout.

### The benchmark contract

```json
{"metric": "p50_latency_ms", "value": 123.4, "secondary": {"memory_mb": 87}}
```

For an HTTP API, let Paxcli own the app lifecycle — it picks a free port, starts your app with `PORT` set, waits for the readiness URL, then runs your sample command with `TARGET_URL` set:

```jsonc
// paxcli.config.json (excerpt)
{
  "benchmark": {
    "sampleCmd": "node bench.js",
    "server": { "startCmd": "npm start", "readyUrl": "http://127.0.0.1:{port}/health" },
    "metric": "p50_latency_ms",
    "direction": "minimize",
    "warmupSamples": 2,
    "samples": 8
  }
}
```

A minimal `bench.js`:

```js
const target = process.env.TARGET_URL;
const times = [];
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  await fetch(`${target}/your-hot-endpoint`).then((r) => r.json());
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ metric: 'p50_latency_ms', value: times[Math.floor(times.length / 2)] }));
```

## 3. Configure gates and protections

```jsonc
{
  "gates": [
    { "id": "tests", "name": "test suite", "cmd": "npm test", "kind": "tests" }
  ],
  "policy": {
    "writable": ["src/**"],
    "protected": ["paxcli.config.json", "bench.js", "test/**", ".github/**"]
  }
}
```

Protected files are integrity-pinned. If an agent touches them, the experiment is rejected before any score is computed.

## 4. Validate, then run

```bash
paxcli doctor              # environment checks with repair steps
paxcli benchmark validate  # refuses to optimize against a noisy benchmark
paxcli start --preset quick --budget 2
```

## 5. Review the result

```bash
paxcli status
paxcli run explain <nodeId>   # full receipt + Verification Card
paxcli apply                  # creates paxcli/winner/<run-id> — you merge, Paxcli never does
```

Interrupted? `paxcli resume`. Leftovers? `paxcli gc`.
