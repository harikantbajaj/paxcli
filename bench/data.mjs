// Deterministic latency-shaped datasets for benchmarking the stats pipeline.
// Seeded LCG so every machine and every run sees identical inputs.
export function makeSamples(seed, n, base, spread) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(base + (next() - 0.5) * 2 * spread + next() * spread * 0.5);
  }
  return out;
}

export const CASES = [
  { baseline: makeSamples(42, 40, 100, 10), candidate: makeSamples(43, 40, 80, 8) },
  { baseline: makeSamples(7, 60, 250, 30), candidate: makeSamples(8, 60, 240, 28) },
  { baseline: makeSamples(1234, 25, 12, 1.5), candidate: makeSamples(1235, 25, 6, 0.8) },
];
