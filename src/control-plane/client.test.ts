import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../engine/run-loop.js';
import { FleetClient } from './client.js';
import { startFleetDashboard } from './server.js';

describe('FleetClient', () => {
  it('streams a complete agent run without repository state files', async () => {
    const dashboard = await startFleetDashboard();
    try {
      const client = FleetClient.fromEnvironment({ PAXCLI_FLEET_URL: dashboard.url });
      expect(client).not.toBeNull();
      await client?.begin({
        repoRoot: 'C:/work/payments-api',
        request: 'Reduce checkout latency',
        agent: 'codex',
        model: 'gpt-5',
      });
      await client?.status('Testing hypothesis: batch repeated lookups');
      await client?.finish({
        runId: 'run-1',
        reason: 'completed',
        baseline: null,
        bestNode: null,
        totalCostUsd: 0.7,
        nodesTried: 1,
        receipts: [],
      } satisfies RunOutcome);

      const snapshot = dashboard.store.snapshot();
      expect(snapshot.repositories[0]?.name).toBe('payments-api');
      expect(snapshot.runs[0]?.agent).toBe('codex');
      expect(snapshot.runs[0]?.status).toBe('rejected');
      expect(snapshot.activities.some((activity) => activity.kind === 'hypothesis')).toBe(true);
    } finally {
      await dashboard.close();
    }
  });
});
