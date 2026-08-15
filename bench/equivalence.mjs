// Output-equivalence gate: the stats pipeline must produce numerically
// identical results (within 1e-9 relative tolerance, which permits float
// reordering but not behavior changes) to the pinned golden fixture.
import { readFileSync } from 'node:fs';
import { CASES } from './data.mjs';

const stats = await import(new URL('../src/bench/stats.ts', import.meta.url).href);
const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));

function close(a, b, path) {
  if (a === null || b === null) {
    if (a !== b) fail(path, a, b);
    return;
  }
  if (typeof a === 'number') {
    const tol = Math.max(1e-9, Math.abs(b) * 1e-9);
    if (Number.isNaN(a) || Math.abs(a - b) > tol) fail(path, a, b);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) fail(`${path}.length`, a.length, b.length);
    a.forEach((v, i) => close(v, b[i], `${path}[${i}]`));
    return;
  }
  if (typeof a === 'object') {
    for (const k of Object.keys(b)) close(a[k], b[k], `${path}.${k}`);
    return;
  }
  if (a !== b) fail(path, a, b);
}

function fail(path, actual, expected) {
  console.error(`OUTPUT MISMATCH at ${path}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  process.exit(1);
}

CASES.forEach((c, i) => {
  const cmp = stats.compare(c.baseline, c.candidate, 'minimize', 1);
  const g = golden.compare[i];
  close(cmp.improvementPct, g.improvementPct, `compare[${i}].improvementPct`);
  close(cmp.noiseFloorPct, g.noiseFloorPct, `compare[${i}].noiseFloorPct`);
  close(cmp.ci95, g.ci95, `compare[${i}].ci95`);
  close(cmp.effectSize, g.effectSize, `compare[${i}].effectSize`);
  close(cmp.meaningful, g.meaningful, `compare[${i}].meaningful`);

  const sum = stats.summarize(c.baseline);
  const gs = golden.summarize[i];
  close(sum.median, gs.median, `summarize[${i}].median`);
  close(sum.mean, gs.mean, `summarize[${i}].mean`);
  close(sum.stddev, gs.stddev, `summarize[${i}].stddev`);
  close(sum.p95, gs.p95, `summarize[${i}].p95`);
});

console.log('stats outputs match the golden fixture');
