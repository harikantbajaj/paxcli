import { describe, expect, it } from 'vitest';
import type { Receipt } from '../proof/receipt.js';
import { buildCardRows, renderVerificationCard } from './card.js';

function receipt(overrides: Partial<Receipt> = {}): Receipt {
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
      display: '51.0 → 7.0 (−86.9%)',
    },
    gates: [
      {
        gateId: 'tests',
        name: 'unit tests',
        pass: true,
        exitCode: 0,
        durationMs: 100,
        stdoutTail: '',
      },
    ],
    pinsVerified: true,
    risks: ['empty catch added in handler.ts'],
    withheld: { configured: true, pass: true, category: null },
    reproduction: { held: true, display: 'held at −85%' },
    environment: { os: 'test', arch: 'x64', node: 'v20' },
    configHash: 'deadbeef',
    createdAt: '2026-08-16T00:00:00.000Z',
    reproduceCmd: 'paxcli run reproduce node-1 --run run-1',
    ...overrides,
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping requires control chars
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('buildCardRows', () => {
  it('assembles every evidence row in display order', () => {
    const rows = buildCardRows(receipt());
    expect(rows.map((r) => r.label)).toEqual([
      'report_latency_ms',
      'Verification',
      'Threshold',
      'Gate: unit tests',
      'Withheld checks',
      'Fresh reproduction',
      'Files protected',
      'Remaining risk',
      'Cost to find',
      'Commits',
      'Decision',
      'Reproduce',
    ]);
    expect(rows.find((r) => r.label === 'Decision')?.mark).toBe('pass');
  });

  it('marks failures and omits absent evidence', () => {
    const rows = buildCardRows(
      receipt({
        decision: 'rejected',
        grade: null,
        withheld: null,
        reproduction: null,
        risks: [],
        comparison: null,
        baseline: null,
        candidate: null,
        pinsVerified: false,
      }),
    );
    const labels = rows.map((r) => r.label);
    expect(labels).not.toContain('Withheld checks');
    expect(labels).not.toContain('Fresh reproduction');
    expect(labels).not.toContain('Threshold');
    expect(rows.find((r) => r.label === 'Files protected')?.mark).toBe('fail');
    expect(rows.find((r) => r.label === 'Decision')?.mark).toBe('fail');
  });
});

describe('renderVerificationCard', () => {
  it('renders an aligned box containing every row', () => {
    const card = stripAnsi(renderVerificationCard(receipt()));
    const lines = card.split('\n');
    expect(lines[0]).toContain('PAXCLI VERIFICATION');
    expect(lines.at(-1)?.startsWith('└')).toBe(true);
    // Every body line is padded to the same visible width.
    const widths = new Set(lines.slice(1, -1).map((l) => l.length));
    expect(widths.size).toBe(1);
    expect(card).toContain('✓ passed');
    expect(card).toContain('Reproduced — held in a fresh environment');
    expect(card).toContain('paxcli run reproduce node-1 --run run-1');
  });
});
