// Dependency-free correctness gate for the stats module (node --test).
// Runs in experiment worktrees without node_modules.
import assert from 'node:assert';
import { test } from 'node:test';
import { CASES } from './data.mjs';

const stats = await import(new URL('../src/bench/stats.ts', import.meta.url).href);

test('summarize computes correct median and bounds', () => {
  const s = stats.summarize([5, 1, 3, 2, 4]);
  assert.equal(s.median, 3);
  assert.equal(s.min, 1);
  assert.equal(s.max, 5);
  assert.equal(s.n, 5);
});

test('p95 refused below 20 observations', () => {
  assert.equal(stats.summarize([1, 2, 3]).p95, null);
  const many = Array.from({ length: 25 }, (_, i) => i);
  assert.notEqual(stats.summarize(many).p95, null);
});

test('percentile interpolates correctly', () => {
  assert.equal(stats.percentile([10, 20, 30, 40], 50), 25);
  assert.equal(stats.percentile([10, 20], 0), 10);
  assert.equal(stats.percentile([10, 20], 100), 20);
});

test('compare detects a clear improvement (minimize)', () => {
  const c = stats.compare([100, 101, 99, 100, 102, 98], [50, 51, 49, 50, 52, 48], 'minimize', 1);
  assert.ok(c.improvementPct > 45 && c.improvementPct < 55);
  assert.equal(c.meaningful, true);
  assert.ok(c.ci95 !== null);
  assert.ok(c.effectSize > 2);
});

test('compare never accepts improvement inside the noise band', () => {
  const c = stats.compare([100, 110, 90, 105, 95], [97, 107, 87, 102, 92], 'minimize', 1);
  assert.equal(c.meaningful, false);
});

test('compare respects maximize direction', () => {
  const c = stats.compare([100, 100, 100, 100, 100], [150, 150, 150, 150, 150], 'maximize', 1);
  assert.ok(c.improvementPct > 0);
});

test('bootstrapCI is deterministic and ordered', () => {
  const { baseline, candidate } = CASES[0];
  const a = stats.bootstrapCI(baseline, candidate, 'minimize');
  const b = stats.bootstrapCI(baseline, candidate, 'minimize');
  assert.deepEqual(a, b);
  assert.ok(a[0] <= a[1]);
});

test('assessStability flags noisy benchmarks', () => {
  assert.equal(stats.assessStability([10, 30, 5, 50, 12]).ok, false);
  assert.equal(stats.assessStability([100, 101, 99, 100, 102]).ok, true);
});
