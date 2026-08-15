import { describe, expect, it } from 'vitest';
import { MIN_SAMPLES_FOR_P95, assessStability, compare, summarize } from './stats.js';

describe('summarize', () => {
  it('computes median and refuses p95 below the sample threshold', () => {
    const s = summarize([10, 12, 11, 13, 9]);
    expect(s.median).toBe(11);
    expect(s.p95).toBeNull();
  });

  it('reports p95 with enough observations', () => {
    const samples = Array.from({ length: MIN_SAMPLES_FOR_P95 }, (_, i) => i + 1);
    const s = summarize(samples);
    expect(s.p95).not.toBeNull();
    expect(s.p95).toBeGreaterThan(s.median);
  });
});

describe('compare', () => {
  it('accepts improvements that clear both noise floor and configured minimum', () => {
    const baseline = [100, 101, 99, 100, 100];
    const candidate = [50, 51, 49, 50, 50];
    const c = compare(baseline, candidate, 'minimize', 1);
    expect(c.improvementPct).toBeGreaterThan(45);
    expect(c.meaningful).toBe(true);
  });

  it('never accepts an improvement smaller than measured noise', () => {
    // ~10% noise in the baseline, only ~3% improvement: inside the noise band.
    const baseline = [100, 110, 90, 105, 95];
    const candidate = [97, 107, 87, 102, 92];
    const c = compare(baseline, candidate, 'minimize', 1);
    expect(c.noiseFloorPct).toBeGreaterThan(3);
    expect(c.meaningful).toBe(false);
  });

  it('respects maximize direction', () => {
    const c = compare([100, 100, 100], [150, 150, 150], 'maximize', 1);
    expect(c.improvementPct).toBeGreaterThan(0);
    expect(c.meaningful).toBe(true);
  });
});

describe('assessStability', () => {
  it('flags noisy benchmarks', () => {
    const v = assessStability([10, 30, 5, 50, 12]);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes('noise'))).toBe(true);
  });

  it('accepts stable benchmarks', () => {
    const v = assessStability([100, 101, 99, 100, 102]);
    expect(v.ok).toBe(true);
  });
});
