/**
 * Benchmark statistics that refuse to overclaim.
 *
 * Rules encoded here:
 *  - p95 is refused below MIN_SAMPLES_FOR_P95 observations (small-sample tail
 *    percentiles are noise dressed up as precision).
 *  - The minimum meaningful improvement derives from the measured noise floor,
 *    never from a fixed constant alone.
 *  - Displayed precision matches what the sample size supports.
 */

export const MIN_SAMPLES_FOR_P95 = 20;

export interface SampleSummary {
  n: number;
  median: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  /** Coefficient of variation as a percentage — the noise measure. */
  cvPct: number;
  /** Present only when n >= MIN_SAMPLES_FOR_P95. */
  p95: number | null;
}

export function summarize(samples: number[]): SampleSummary {
  if (samples.length === 0) throw new Error('Cannot summarize zero samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  return {
    n,
    median: percentile(sorted, 50),
    mean,
    stddev,
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
    cvPct: mean !== 0 ? (stddev / Math.abs(mean)) * 100 : 0,
    p95: n >= MIN_SAMPLES_FOR_P95 ? percentile(sorted, 95) : null,
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0] as number;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

export interface Comparison {
  baselineMedian: number;
  candidateMedian: number;
  /** Positive = candidate improved, in the metric's better direction. */
  improvementPct: number;
  /** Noise floor in percent: the larger CV of the two sample sets. */
  noiseFloorPct: number;
  /** Threshold actually applied: max(noise floor, configured minimum). */
  requiredPct: number;
  meaningful: boolean;
  /** Bootstrap 95% CI on the median improvement %, when samples allow it. */
  ci95: [number, number] | null;
  /** Cohen's d effect size (pooled), when samples allow it. */
  effectSize: number | null;
  /** How the numbers should be displayed without fake precision. */
  display: string;
}

export function compare(
  baseline: number[],
  candidate: number[],
  direction: 'minimize' | 'maximize',
  configuredMinPct: number,
): Comparison {
  const b = summarize(baseline);
  const c = summarize(candidate);
  const rawDelta = ((b.median - c.median) / Math.abs(b.median || 1)) * 100;
  const improvementPct = direction === 'minimize' ? rawDelta : -rawDelta;
  const noiseFloorPct = Math.max(b.cvPct, c.cvPct);
  const requiredPct = Math.max(noiseFloorPct, configuredMinPct);
  const meaningful = improvementPct > requiredPct;

  const enoughForInference = b.n >= 5 && c.n >= 5;
  const ci95 = enoughForInference ? bootstrapCI(baseline, candidate, direction) : null;
  const effectSize = enoughForInference ? cohensD(baseline, candidate) : null;

  const digits = b.n + c.n >= 20 ? 1 : 0;
  const ciText = ci95 ? `, 95% CI ${fmtPct(ci95[0], digits)}…${fmtPct(ci95[1], digits)}` : '';
  const display = `${b.median.toFixed(digits)} → ${c.median.toFixed(digits)} (${fmtPct(improvementPct, digits)}, noise ±${noiseFloorPct.toFixed(digits)}%${ciText})`;
  return {
    baselineMedian: b.median,
    candidateMedian: c.median,
    improvementPct,
    noiseFloorPct,
    requiredPct,
    meaningful,
    ci95,
    effectSize,
    display,
  };
}

function fmtPct(pct: number, digits: number): string {
  return `${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(digits)}%`;
}

/**
 * Bootstrap 95% CI for the median improvement percentage. Uses a seeded
 * generator so identical samples always yield identical intervals.
 */
export function bootstrapCI(
  baseline: number[],
  candidate: number[],
  direction: 'minimize' | 'maximize',
  iterations = 2000,
): [number, number] {
  let seed = 0x9e3779b9 ^ (baseline.length * 31 + candidate.length);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const resampleMedian = (data: number[]): number => {
    const picks: number[] = [];
    for (let i = 0; i < data.length; i++) {
      picks.push(data[Math.floor(rand() * data.length)] as number);
    }
    picks.sort((a, b) => a - b);
    return percentile(picks, 50);
  };
  const deltas: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const bm = resampleMedian(baseline);
    const cm = resampleMedian(candidate);
    const raw = ((bm - cm) / Math.abs(bm || 1)) * 100;
    deltas.push(direction === 'minimize' ? raw : -raw);
  }
  deltas.sort((a, b) => a - b);
  return [percentile(deltas, 2.5), percentile(deltas, 97.5)];
}

/** Cohen's d with pooled standard deviation. */
export function cohensD(baseline: number[], candidate: number[]): number {
  const b = summarize(baseline);
  const c = summarize(candidate);
  const pooled = Math.sqrt(
    ((b.n - 1) * b.stddev ** 2 + (c.n - 1) * c.stddev ** 2) / Math.max(b.n + c.n - 2, 1),
  );
  if (pooled === 0) return 0;
  return Math.abs(b.mean - c.mean) / pooled;
}

export interface StabilityVerdict {
  ok: boolean;
  cvPct: number;
  problems: string[];
}

/** Baseline reliability check: refuses to optimize against a noisy benchmark. */
export function assessStability(samples: number[], maxCvPct = 10): StabilityVerdict {
  const s = summarize(samples);
  const problems: string[] = [];
  if (s.n < 3) problems.push(`only ${s.n} samples — need at least 3`);
  if (s.cvPct > maxCvPct) {
    problems.push(
      `benchmark noise is ${s.cvPct.toFixed(1)}% (limit ${maxCvPct}%) — results this noisy cannot support acceptance decisions`,
    );
  }
  if (s.median === 0)
    problems.push('median measurement is zero — the benchmark may be too fast to measure reliably');
  return { ok: problems.length === 0, cvPct: s.cvPct, problems };
}
