import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskOutcome } from '../engine/task-loop.js';
import type { Receipt } from '../proof/receipt.js';
import {
  appendLedgerEntry,
  computeStats,
  parseLedger,
  renderLedger,
  verifyLedger,
} from './file.js';
import {
  TASK_LABEL_CHECKED,
  TASK_LABEL_UNCHECKED,
  entryFromReceipt,
  entryFromTaskOutcome,
} from './schema.js';

/**
 * Proof Ledger invariants: entries survive a render→parse round trip, appends
 * are idempotent, secrets never reach the file, task entries only ever carry
 * their two honest labels, and `verifyLedger` catches tampering.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-ledger-'));
  await execa('git', ['init', '-b', 'main'], { cwd: root });
});

function fakeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    receiptVersion: 1,
    runId: 'run-1',
    nodeId: 'node-1',
    grade: 'reproduced',
    decision: 'accepted',
    decisionReason: 'Accepted: improved 86.9% vs baseline',
    hypothesis: 'Replace quadratic scan with a Set',
    baseCommit: 'a'.repeat(40),
    finalCommit: 'b'.repeat(40),
    agent: {
      hostId: 'claude-code',
      model: null,
      costUsd: 0.01,
      tokensIn: 100,
      tokensOut: 100,
      durationMs: 22_000,
      exitReason: 'completed',
    },
    baseline: { metric: 'report_latency_ms', value: 51, direction: 'minimize', samples: [51] },
    candidate: { metric: 'report_latency_ms', value: 7, direction: 'minimize', samples: [7] },
    comparison: {
      improvementPct: 86.9,
      noiseFloorPct: 5,
      requiredPct: 5,
      ci95: null,
      effectSize: null,
      display: '51.0 → 7.0 (−86.9%, noise ±5.0%)',
    },
    gates: [
      {
        gateId: 'tests',
        name: 'unit tests',
        pass: true,
        exitCode: 0,
        durationMs: 100,
        stdoutTail: 'SHOULD NEVER REACH THE LEDGER',
      },
    ],
    pinsVerified: true,
    risks: [],
    withheld: { configured: true, pass: true, category: null },
    reproduction: { held: true, display: 'held at −85%' },
    environment: { os: 'test', arch: 'x64', node: 'v20' },
    configHash: 'deadbeef',
    createdAt: '2026-08-16T00:00:00.000Z',
    reproduceCmd: 'paxcli run reproduce node-1 --run run-1',
    ...overrides,
  };
}

function fakeTaskOutcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    runId: 'task-run-1',
    status: 'succeeded',
    reason: 'done',
    summary: 'Made the form responsive',
    changedFiles: ['src/form.tsx'],
    checks: [{ name: 'test', cmd: 'npm test', pass: true, outputTail: 'NOT FOR THE LEDGER' }],
    checksSkipped: false,
    suspicions: [],
    attempts: 1,
    totalCostUsd: 0.02,
    snapshotSha: 'c'.repeat(40),
    resultSha: 'd'.repeat(40),
    patchPath: null,
    worktreePath: null,
    worktreeBranch: null,
    agentFinalText: 'irrelevant',
    intent: 'change',
    ...overrides,
  };
}

describe('entry projections', () => {
  it('projects a receipt without raw command output', () => {
    const entry = entryFromReceipt(fakeReceipt());
    expect(entry.kind).toBe('optimization');
    expect(entry.grade).toBe('reproduced');
    expect(entry.gates).toEqual([{ name: 'unit tests', pass: true }]);
    expect(JSON.stringify(entry)).not.toContain('SHOULD NEVER REACH THE LEDGER');
  });

  it('redacts secrets in every string field', () => {
    const entry = entryFromReceipt(
      fakeReceipt({ hypothesis: 'use api_key=supersecret123 for the cache' }),
    );
    expect(entry.hypothesis).not.toContain('supersecret123');
    expect(entry.hypothesis).toContain('[REDACTED]');
  });

  it('gives task entries only their two honest labels', () => {
    expect(entryFromTaskOutcome(fakeTaskOutcome()).label).toBe(TASK_LABEL_CHECKED);
    expect(entryFromTaskOutcome(fakeTaskOutcome({ checksSkipped: true, checks: [] })).label).toBe(
      TASK_LABEL_UNCHECKED,
    );
  });
});

describe('append / parse round trip', () => {
  it('creates the file, then parses back the identical entry', async () => {
    const entry = entryFromReceipt(fakeReceipt());
    const res = await appendLedgerEntry({ repoRoot: root, entry });
    expect(res.added).toBe(true);
    const content = await readFile(res.file, 'utf8');
    expect(content).toContain('# Proof Ledger');
    expect(content).toContain('paxcli-ledger v1');
    const parsed = parseLedger(content);
    expect(parsed.problems).toEqual([]);
    expect(parsed.entries).toEqual([entry]);
    expect(parsed.statedStats).toEqual(computeStats([entry]));
  });

  it('is idempotent for the same run/node', async () => {
    const entry = entryFromReceipt(fakeReceipt());
    await appendLedgerEntry({ repoRoot: root, entry });
    const again = await appendLedgerEntry({ repoRoot: root, entry });
    expect(again.added).toBe(false);
    expect(again.entryCount).toBe(1);
  });

  it('accumulates mixed entry kinds and keeps stats consistent', async () => {
    await appendLedgerEntry({ repoRoot: root, entry: entryFromReceipt(fakeReceipt()) });
    await appendLedgerEntry({ repoRoot: root, entry: entryFromTaskOutcome(fakeTaskOutcome()) });
    const parsed = parseLedger(await readFile(path.join(root, 'PROOF.md'), 'utf8'));
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.statedStats).toEqual({
      entries: 2,
      optimizations: 1,
      tasks: 1,
      bestImprovementPct: 86.9,
    });
  });
});

describe('verifyLedger', () => {
  it('passes a freshly written ledger (missing commits are warnings, not errors)', async () => {
    await appendLedgerEntry({ repoRoot: root, entry: entryFromReceipt(fakeReceipt()) });
    const verdict = await verifyLedger({ repoRoot: root });
    expect(verdict.errors).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.length).toBeGreaterThan(0); // fake shas don't exist here
  });

  it('fails when an entry block is tampered with', async () => {
    await appendLedgerEntry({ repoRoot: root, entry: entryFromReceipt(fakeReceipt()) });
    const file = path.join(root, 'PROOF.md');
    const content = await readFile(file, 'utf8');
    await writeFile(file, content.replace('"kind": "optimization"', '"kind": "miracle"'), 'utf8');
    const verdict = await verifyLedger({ repoRoot: root });
    expect(verdict.ok).toBe(false);
  });

  it('fails when the stats header drifts from the entries', async () => {
    await appendLedgerEntry({ repoRoot: root, entry: entryFromReceipt(fakeReceipt()) });
    const file = path.join(root, 'PROOF.md');
    const content = await readFile(file, 'utf8');
    await writeFile(file, content.replace('"entries":1', '"entries":7'), 'utf8');
    const verdict = await verifyLedger({ repoRoot: root });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(' ')).toContain('stats header');
  });

  it('reports a missing ledger as not ok', async () => {
    const verdict = await verifyLedger({ repoRoot: root });
    expect(verdict.ok).toBe(false);
  });
});

describe('renderLedger', () => {
  it('orders entries chronologically regardless of append order', () => {
    const older = entryFromTaskOutcome(fakeTaskOutcome(), '2026-01-01T00:00:00.000Z');
    const newer = entryFromReceipt(fakeReceipt(), '2026-08-16T00:00:00.000Z');
    const content = renderLedger([newer, older]);
    expect(content.indexOf('2026-01-01')).toBeLessThan(content.indexOf('2026-08-16'));
  });
});
