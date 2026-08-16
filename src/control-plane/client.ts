import path from 'node:path';
import type { RunOutcome } from '../engine/run-loop.js';

/**
 * Best-effort event reporter for a separately running Fleet dashboard. The
 * connection is provided only through environment variables; no repository
 * config or local event file is created. Dashboard failures never fail an
 * optimization run.
 */
export class FleetClient {
  private runId: string | null = null;

  private constructor(
    private readonly baseUrl: URL,
    private readonly token: string,
  ) {}

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): FleetClient | null {
    const raw = env.PAXCLI_FLEET_URL?.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      const token = env.PAXCLI_FLEET_TOKEN?.trim() || url.searchParams.get('t');
      if (!token) return null;
      url.pathname = '/';
      url.search = '';
      return new FleetClient(url, token);
    } catch {
      return null;
    }
  }

  async begin(input: {
    repoRoot: string;
    request: string;
    agent: string;
    model?: string | null;
  }): Promise<void> {
    const repositoryName = process.env.PAXCLI_REPOSITORY?.trim() || path.basename(input.repoRoot);
    const repository = await this.request<{ id: string }>('/api/repositories', 'POST', {
      name: repositoryName,
      provider: 'local',
      visibility: 'unknown',
    });
    if (!repository) return;
    const run = await this.request<{ id: string }>('/api/runs', 'POST', {
      repositoryId: repository.id,
      request: input.request,
      agent: input.agent,
      model: input.model ?? null,
    });
    this.runId = run?.id ?? null;
    if (this.runId) {
      await this.update({ status: 'running', stage: 'Starting verification run' });
      await this.activity(
        'system',
        'Agent run started',
        `${input.agent}${input.model ? ` · ${input.model}` : ''}`,
      );
    }
  }

  async status(message: string): Promise<void> {
    if (!this.runId) return;
    const kind = classify(message);
    await Promise.all([
      this.update({ status: 'running', stage: message.slice(0, 200) }),
      this.activity(kind, activityTitle(message), message),
    ]);
  }

  async finish(outcome: RunOutcome): Promise<void> {
    if (!this.runId) return;
    const receipt = outcome.bestNode
      ? outcome.receipts.find((candidate) => candidate.nodeId === outcome.bestNode?.id)
      : null;
    const summary = receipt
      ? `${receipt.hypothesis} — ${receipt.comparison?.display ?? receipt.decisionReason}`
      : 'No verified improvement this run.';
    await this.activity(
      'decision',
      receipt ? 'Verified improvement accepted' : 'Run completed without a verified winner',
      summary,
    );
    await this.update({
      status: receipt ? 'completed' : 'rejected',
      stage: receipt ? 'Verified result ready for review' : 'No verified improvement',
      summary,
      output: receipt?.decisionReason ?? outcome.reason,
      costUsd: outcome.totalCostUsd,
      finishedAt: new Date().toISOString(),
    });
  }

  async fail(error: unknown): Promise<void> {
    if (!this.runId) return;
    const message = error instanceof Error ? error.message : String(error);
    await this.activity('system', 'Run failed', message);
    await this.update({
      status: 'failed',
      stage: 'Run failed',
      output: message,
      finishedAt: new Date().toISOString(),
    });
  }

  private async activity(kind: string, title: string, detail: string): Promise<void> {
    if (!this.runId) return;
    await this.request(`/api/runs/${encodeURIComponent(this.runId)}/activities`, 'POST', {
      kind,
      title,
      detail,
    });
  }

  private async update(patch: Record<string, unknown>): Promise<void> {
    if (!this.runId) return;
    await this.request(`/api/runs/${encodeURIComponent(this.runId)}`, 'PATCH', patch);
  }

  private async request<T = unknown>(
    pathname: string,
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      const url = new URL(pathname, this.baseUrl);
      url.searchParams.set('t', this.token);
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }
}

function classify(message: string): string {
  if (/hypothesis|testing/i.test(message)) return 'hypothesis';
  if (/baseline|sampling|benchmark|warming/i.test(message)) return 'benchmark';
  if (/gate|test|check|integrity|withheld/i.test(message)) return 'check';
  if (/accepted|rejected|winner|decision|reproduc/i.test(message)) return 'decision';
  if (/file|worktree|workspace|commit/i.test(message)) return 'file';
  return 'plan';
}

function activityTitle(message: string): string {
  const first = message.split(/\r?\n/, 1)[0]?.trim() ?? 'Agent activity';
  return first.length > 100 ? `${first.slice(0, 97)}...` : first;
}
