// Correctness tests (gate). Runs without any test framework.
import assert from 'node:assert';
import { buildReport, makeDataset } from './lib.js';

const data = makeDataset();
const report = buildReport(data);

assert.equal(typeof report.sum, 'number');
assert.equal(typeof report.uniqueCount, 'number');
assert.ok(Array.isArray(report.top10) && report.top10.length === 10);

// The dataset is deterministic, so exact expectations hold everywhere.
const expectedSum = data.reduce((s, v) => s + v, 0);
assert.equal(report.sum, expectedSum, 'sum must match the dataset');

const expectedUnique = new Set(data).size;
assert.equal(report.uniqueCount, expectedUnique, 'uniqueCount must match the dataset');

const expectedTop10 = [...data].sort((a, b) => b - a).slice(0, 10);
assert.deepEqual(report.top10, expectedTop10, 'top10 must be the 10 largest values');

console.log('all tests passed');
