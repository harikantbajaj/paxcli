import { describe, expect, it } from 'vitest';
import { MemoryControlPlane } from './store.js';

describe('MemoryControlPlane', () => {
  it('tracks repositories, agent work, outcomes, and approvals without a filesystem', () => {
    const store = new MemoryControlPlane();
    const repo = store.connectRepository({ name: 'acme/payments-api', visibility: 'private' });
    const run = store.createRun({
      repositoryId: repo.id,
      request: 'Reduce checkout p95 latency',
      agent: 'codex',
      model: 'gpt-5',
    });
    store.updateRun(run.id, { status: 'running', stage: 'Measuring baseline', costUsd: 0.42 });
    store.appendActivity({
      runId: run.id,
      kind: 'hypothesis',
      title: 'Batch repeated customer lookups',
      detail: 'The endpoint performs 48 similar queries.',
    });
    store.requestApproval(run.id, 'Open a PR with the verified result');

    let snapshot = store.snapshot();
    expect(snapshot.repositories).toHaveLength(1);
    expect(snapshot.runs[0]?.status).toBe('waiting-approval');
    expect(snapshot.activities[0]?.kind).toBe('hypothesis');
    expect(snapshot.runs[0]?.approval.status).toBe('pending');

    store.decideApproval(run.id, true, 'backend-lead');
    snapshot = store.snapshot();
    expect(snapshot.runs[0]?.approval.status).toBe('approved');
    expect(snapshot.runs[0]?.status).toBe('running');
  });

  it('redacts secrets before dashboard state is retained', () => {
    const store = new MemoryControlPlane();
    const repo = store.connectRepository({ name: 'acme/private-api' });
    const run = store.createRun({
      repositoryId: repo.id,
      request: 'Inspect token sk-abcdefghijklmnopqrstuvwxyz123456',
      agent: 'claude-code',
    });
    store.appendActivity({
      runId: run.id,
      kind: 'tool',
      title: 'Called API',
      detail: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    });

    const serialized = JSON.stringify(store.snapshot());
    expect(serialized).toContain('REDACTED');
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('removes repository runs and activities when disconnected', () => {
    const store = new MemoryControlPlane();
    const repo = store.connectRepository({ name: 'acme/temporary' });
    const run = store.createRun({ repositoryId: repo.id, request: 'Optimize', agent: 'codex' });
    store.appendActivity({ runId: run.id, kind: 'system', title: 'Started' });

    expect(store.disconnectRepository(repo.id)).toBe(true);
    expect(store.snapshot()).toEqual({ repositories: [], runs: [], activities: [] });
  });
});
