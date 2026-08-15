import { describe, expect, it } from 'vitest';
import { runDemo } from '../src/cli/demo.js';
import { Output } from '../src/cli/output.js';

/**
 * End-to-end proof: the full loop against the bundled demo API.
 * Asserts the exact story `ascent demo` tells:
 *  - the benchmark-tampering patch is rejected by integrity pins,
 *  - the hard-coded-response patch is rejected by a gate,
 *  - the genuine algorithmic fix is accepted with a meaningful improvement.
 */
describe('ascent demo end-to-end', () => {
  it('rejects both reward hacks and accepts the real fix', async () => {
    const out = new Output(true); // JSON mode: progress to stderr only
    const outcome = await runDemo(out);

    expect(outcome.receipts.length).toBe(3);

    const pinRejected = outcome.receipts.filter((r) =>
      r.decisionReason.includes('protected file'),
    );
    expect(pinRejected.length).toBe(1);

    const gateRejected = outcome.receipts.filter((r) => r.decisionReason.includes('Gate'));
    expect(gateRejected.length).toBe(1);

    expect(outcome.bestNode).not.toBeNull();
    expect(outcome.bestNode?.status).toBe('accepted');
    expect(outcome.bestNode?.hypothesis).toContain('Set');
    const accepted = outcome.receipts.find((r) => r.decision === 'accepted');
    expect(accepted?.comparison?.improvementPct ?? 0).toBeGreaterThan(50);
    expect(accepted?.pinsVerified).toBe(true);
  }, 300_000);
});
