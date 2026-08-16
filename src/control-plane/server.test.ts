import { describe, expect, it } from 'vitest';
import { startFleetDashboard } from './server.js';

describe('fleet dashboard server', () => {
  it('serves multi-repository state and authenticated event ingestion', async () => {
    const dashboard = await startFleetDashboard({ repositories: ['acme/api', 'acme/web'] });
    try {
      const stateUrl = new URL('/api/state', dashboard.url);
      stateUrl.searchParams.set('t', dashboard.token);
      const initial = (await fetch(stateUrl).then((r) => r.json())) as { repositories: unknown[] };
      expect(initial.repositories).toHaveLength(2);

      const createRunUrl = new URL('/api/runs', dashboard.url);
      createRunUrl.searchParams.set('t', dashboard.token);
      const response = await fetch(createRunUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repositoryId: 'acme/api',
          request: 'Reduce report latency',
          agent: 'codex',
        }),
      });
      expect(response.status).toBe(201);
      const run = (await response.json()) as { id: string };

      const activityUrl = new URL(`/api/runs/${run.id}/activities`, dashboard.url);
      activityUrl.searchParams.set('t', dashboard.token);
      expect(
        (
          await fetch(activityUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'plan', title: 'Profile the endpoint' }),
          })
        ).status,
      ).toBe(201);

      const finalState = (await fetch(stateUrl).then((r) => r.json())) as {
        runs: unknown[];
        activities: unknown[];
      };
      expect(finalState.runs).toHaveLength(1);
      expect(finalState.activities).toHaveLength(1);
    } finally {
      await dashboard.close();
    }
  });

  it('rejects unauthenticated and oversized or non-JSON mutations', async () => {
    const dashboard = await startFleetDashboard();
    try {
      expect((await fetch(`${new URL('/api/state', dashboard.url).origin}/api/state`)).status).toBe(
        401,
      );
      const url = new URL('/api/repositories', dashboard.url);
      url.searchParams.set('t', dashboard.token);
      expect((await fetch(url, { method: 'POST', body: 'name=repo' })).status).toBe(415);
    } finally {
      await dashboard.close();
    }
  });
});
