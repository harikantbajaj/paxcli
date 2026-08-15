// Benchmark sample for paxcli: times the full comparison pipeline
// (summarize + bootstrap CI + effect size) that runs on every experiment.
// Prints one JSON result line, per the paxcli benchmark contract.
// Runs src/ directly via Node's native TypeScript type stripping (Node >= 23).
import { CASES } from './data.mjs';

const stats = await import(new URL('../src/bench/stats.ts', import.meta.url).href);

// Warm-up so JIT tiers settle before we measure.
for (let i = 0; i < 5; i++) {
  for (const c of CASES) stats.compare(c.baseline, c.candidate, 'minimize', 1);
}

const ITERATIONS = 30;
const times = [];
for (let i = 0; i < ITERATIONS; i++) {
  const started = performance.now();
  for (const c of CASES) {
    stats.compare(c.baseline, c.candidate, 'minimize', 1);
  }
  times.push(performance.now() - started);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(JSON.stringify({ metric: 'stats_pipeline_ms', value: Number(median.toFixed(3)) }));
