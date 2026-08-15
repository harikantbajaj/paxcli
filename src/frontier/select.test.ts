import { describe, expect, it } from 'vitest';
import { parseConfig } from '../config/schema.js';
import type { ExperimentNode } from '../tree/types.js';
import { selectParent } from './select.js';

function node(id: string, value: number): ExperimentNode {
  return {
    id,
    parentId: null,
    depth: 1,
    branch: `paxcli/exp/${id}`,
    commitSha: 'abc',
    hypothesis: id,
    status: 'accepted',
    score: { metric: 'ms', value, direction: 'minimize', samples: [value] },
    grade: 'validated',
    gateResults: [],
    agentRun: null,
    decisionReason: null,
    createdAt: '',
    finishedAt: null,
  };
}

const baseConfig = {
  benchmark: { sampleCmd: 'x', metric: 'ms', direction: 'minimize' },
};

describe('frontier selection', () => {
  it('best-first picks the best accepted node', () => {
    const config = parseConfig(JSON.stringify(baseConfig));
    const nodes = new Map([
      ['a', node('a', 100)],
      ['b', node('b', 40)],
      ['c', node('c', 70)],
    ]);
    expect(selectParent(nodes, config)?.id).toBe('b');
  });

  it('returns null (root) when nothing is accepted yet', () => {
    const config = parseConfig(JSON.stringify(baseConfig));
    expect(selectParent(new Map(), config)).toBeNull();
  });

  it('epsilon-greedy explores when the coin says so', () => {
    const config = parseConfig(
      JSON.stringify({ ...baseConfig, search: { strategy: 'epsilon-greedy', epsilon: 1 } }),
    );
    const nodes = new Map([
      ['a', node('a', 100)],
      ['b', node('b', 40)],
    ]);
    // rand: first call (epsilon check) low → explore; second call picks pool index 0 → root.
    const picked = selectParent(nodes, config, () => 0);
    expect(picked).toBeNull();
  });

  it('epsilon-greedy exploits with epsilon 0', () => {
    const config = parseConfig(
      JSON.stringify({ ...baseConfig, search: { strategy: 'epsilon-greedy', epsilon: 0 } }),
    );
    const nodes = new Map([
      ['a', node('a', 100)],
      ['b', node('b', 40)],
    ]);
    expect(selectParent(nodes, config, () => 0.99)?.id).toBe('b');
  });
});
