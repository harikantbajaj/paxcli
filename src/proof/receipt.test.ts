import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExperimentNode } from '../tree/types.js';
import { type Receipt, buildReceipt, writeReceipt } from './receipt.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'paxcli-receipt-'));
});

function node(overrides: Partial<ExperimentNode> = {}): ExperimentNode {
  return {
    id: 'node-1',
    parentId: null,
    depth: 1,
    branch: 'paxcli/exp/node-1',
    commitSha: 'b'.repeat(40),
    hypothesis: 'Cache the parsed config',
    status: 'accepted',
    score: { metric: 'p50_ms', value: 7, direction: 'minimize', samples: [7, 7, 8] },
    grade: 'equivalent',
    gateResults: [],
    agentRun: null,
    decisionReason: 'Accepted: improved 40% vs baseline',
    createdAt: '2026-08-16T00:00:00.000Z',
    finishedAt: '2026-08-16T00:01:00.000Z',
    ...overrides,
  };
}

describe('buildReceipt', () => {
  it('captures decision, grade, commits, and the reproduce command', () => {
    const receipt = buildReceipt({
      runId: 'run-1',
      node: node(),
      baseSha: 'a'.repeat(40),
      baseline: { metric: 'p50_ms', value: 12, direction: 'minimize', samples: [12] },
      comparison: null,
      pinsVerified: true,
      configHash: 'cafe',
    });
    expect(receipt.receiptVersion).toBe(1);
    expect(receipt.runId).toBe('run-1');
    expect(receipt.decision).toBe('accepted');
    expect(receipt.grade).toBe('equivalent');
    expect(receipt.baseCommit).toBe('a'.repeat(40));
    expect(receipt.finalCommit).toBe('b'.repeat(40));
    expect(receipt.reproduceCmd).toBe('paxcli run reproduce node-1 --run run-1');
  });

  it('maps node status to the receipt decision', () => {
    const base = {
      runId: 'run-1',
      baseSha: 'a'.repeat(40),
      baseline: null,
      comparison: null,
      pinsVerified: true,
      configHash: 'cafe',
    };
    expect(buildReceipt({ ...base, node: node({ status: 'rejected' }) }).decision).toBe('rejected');
    expect(buildReceipt({ ...base, node: node({ status: 'failed' }) }).decision).toBe('failed');
  });
});

describe('writeReceipt', () => {
  it('writes the full receipt plus a secret-scrubbed redacted variant', async () => {
    const receipt = buildReceipt({
      runId: 'run-1',
      node: node({ hypothesis: 'use api_key=supersecret123 for warmup' }),
      baseSha: 'a'.repeat(40),
      baseline: null,
      comparison: null,
      pinsVerified: true,
      configHash: 'cafe',
    });
    const file = await writeReceipt(dir, receipt);
    expect(file).toBe(path.join(dir, 'node-1.json'));

    const full = JSON.parse(await readFile(file, 'utf8')) as Receipt;
    expect(full.hypothesis).toContain('supersecret123'); // full variant stays local

    const redacted = JSON.parse(
      await readFile(path.join(dir, 'node-1.redacted.json'), 'utf8'),
    ) as Receipt;
    expect(redacted.hypothesis).not.toContain('supersecret123');
    expect(redacted.hypothesis).toContain('[REDACTED]');
    expect(redacted.receiptVersion).toBe(1); // structure survives redaction
    expect(redacted.nodeId).toBe(full.nodeId);
  });
});
