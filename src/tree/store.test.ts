import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventStore } from './store.js';
import type { ExperimentNode } from './types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-store-'));
});

function fakeNode(id: string): ExperimentNode {
  return {
    id,
    parentId: null,
    depth: 1,
    branch: `paxcli/exp/${id}`,
    commitSha: null,
    hypothesis: 'test',
    status: 'pending',
    score: null,
    grade: null,
    gateResults: [],
    agentRun: null,
    decisionReason: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

describe('EventStore', () => {
  it('replays appended events into a run summary', async () => {
    const store = await EventStore.create(root, 'r1');
    await store.append({
      type: 'run_started',
      runId: 'r1',
      baseSha: 'abc',
      baseBranch: 'main',
      configHash: 'h',
      policyHash: 'h',
      startedAt: new Date().toISOString(),
    });
    await store.append({ type: 'node_created', node: fakeNode('n1') });
    await store.append({ type: 'node_updated', nodeId: 'n1', patch: { status: 'accepted' } });
    await store.append({ type: 'cost_recorded', nodeId: 'n1', costUsd: 1.5 });

    const summary = await store.replay();
    expect(summary.runId).toBe('r1');
    expect(summary.nodes.get('n1')?.status).toBe('accepted');
    expect(summary.totalCostUsd).toBe(1.5);
    expect(summary.finished).toBe(false);
  });

  it('drops a torn final line (crash mid-append) but keeps earlier events', async () => {
    const store = await EventStore.create(root, 'r2');
    await store.append({
      type: 'run_started',
      runId: 'r2',
      baseSha: 'abc',
      baseBranch: 'main',
      configHash: 'h',
      policyHash: 'h',
      startedAt: new Date().toISOString(),
    });
    await appendFile(store.eventsPath, '{"v":1,"seq":2,"at":"x","event":{"type":"node_cre', 'utf8');

    const reopened = await EventStore.open(root, 'r2');
    const summary = await reopened.replay();
    expect(summary.runId).toBe('r2');
  });

  it('raises on corruption that is not at the tail', async () => {
    const store = await EventStore.create(root, 'r3');
    await writeFile(
      store.eventsPath,
      'GARBAGE\n{"v":1,"seq":1,"at":"x","event":{"type":"round_started","round":1}}\n',
      'utf8',
    );
    await expect(store.replay()).rejects.toThrow(/corrupt/);
  });

  it('raises on sequence gaps', async () => {
    const store = await EventStore.create(root, 'r4');
    await writeFile(
      store.eventsPath,
      '{"v":1,"seq":1,"at":"x","event":{"type":"round_started","round":1}}\n' +
        '{"v":1,"seq":3,"at":"x","event":{"type":"round_started","round":2}}\n',
      'utf8',
    );
    await expect(store.replay()).rejects.toThrow(/sequence gap/);
  });

  it('survives many concurrent appends (parallel experiments)', async () => {
    const store = await EventStore.create(root, 'r6');
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.append({ type: 'round_started', round: i + 1 })),
    );
    const summary = await store.replay();
    expect(summary.round).toBeGreaterThan(0);
    const reopened = await EventStore.open(root, 'r6');
    const envelopes = await reopened.readAll();
    expect(envelopes.length).toBe(50);
    expect(envelopes.map((e) => e.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('tolerates adjacent events written in swapped file order', async () => {
    const store = await EventStore.create(root, 'r7');
    await writeFile(
      store.eventsPath,
      '{"v":1,"seq":2,"at":"x","event":{"type":"round_started","round":2}}\n' +
        '{"v":1,"seq":1,"at":"x","event":{"type":"round_started","round":1}}\n',
      'utf8',
    );
    const summary = await store.replay();
    expect(summary.round).toBe(2);
  });

  it('resumes sequence numbering after reopen', async () => {
    const store = await EventStore.create(root, 'r5');
    await store.append({ type: 'round_started', round: 1 });
    const reopened = await EventStore.open(root, 'r5');
    const env = await reopened.append({ type: 'round_started', round: 2 });
    expect(env.seq).toBe(2);
  });
});
