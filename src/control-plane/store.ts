import { randomUUID } from 'node:crypto';
import { redactText } from '../proof/redact.js';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'stopped';

export type ActivityKind =
  | 'plan'
  | 'hypothesis'
  | 'tool'
  | 'file'
  | 'benchmark'
  | 'check'
  | 'decision'
  | 'output'
  | 'system';

export interface RepositorySettings {
  benchmarkCommand: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  protectedPaths: string[];
  writablePaths: string[];
  allowedAgents: string[];
  maxCostUsd: number;
  requireApprovalForPr: boolean;
  retentionDays: number;
}

export interface ConnectedRepository {
  id: string;
  name: string;
  provider: 'github' | 'gitlab' | 'local' | 'other';
  defaultBranch: string;
  visibility: 'private' | 'public' | 'unknown';
  connectedAt: string;
  lastActivityAt: string | null;
  settings: RepositorySettings;
}

export interface AgentActivity {
  id: string;
  runId: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail: string;
}

export interface ApprovalState {
  status: 'not-requested' | 'pending' | 'approved' | 'rejected';
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface AgentRun {
  id: string;
  repositoryId: string;
  request: string;
  agent: string;
  model: string | null;
  status: RunStatus;
  stage: string;
  summary: string | null;
  output: string | null;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
  approval: ApprovalState;
}

export interface ControlPlaneSnapshot {
  repositories: ConnectedRepository[];
  runs: AgentRun[];
  activities: AgentActivity[];
}

export interface ControlPlaneEvent {
  type: 'repository' | 'run' | 'activity' | 'approval';
  at: string;
  entityId: string;
}

const DEFAULT_SETTINGS: RepositorySettings = {
  benchmarkCommand: null,
  testCommand: null,
  buildCommand: null,
  protectedPaths: ['.github/**', 'test/**', 'tests/**', '**/*.pem', '.env*'],
  writablePaths: ['src/**'],
  allowedAgents: ['claude-code', 'codex'],
  maxCostUsd: 5,
  requireApprovalForPr: true,
  retentionDays: 30,
};

/**
 * Service-side state for the fleet dashboard. This implementation is
 * intentionally memory-only: starting or using the dashboard never writes a
 * config, receipt, JSON log, or hidden directory into a connected repository.
 * A hosted deployment can replace this class with an encrypted database while
 * preserving the API contract.
 */
export class MemoryControlPlane {
  private repositories = new Map<string, ConnectedRepository>();
  private runs = new Map<string, AgentRun>();
  private activities: AgentActivity[] = [];
  private listeners = new Set<(event: ControlPlaneEvent) => void>();

  subscribe(listener: (event: ControlPlaneEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ControlPlaneSnapshot {
    return {
      repositories: [...this.repositories.values()].map(cloneRepository),
      runs: [...this.runs.values()].map(cloneRun),
      activities: this.activities.map((activity) => ({ ...activity })),
    };
  }

  connectRepository(input: {
    id?: string;
    name: string;
    provider?: ConnectedRepository['provider'];
    defaultBranch?: string;
    visibility?: ConnectedRepository['visibility'];
    settings?: Partial<RepositorySettings>;
  }): ConnectedRepository {
    const now = new Date().toISOString();
    const id = safeId(input.id ?? input.name);
    const existing = this.repositories.get(id);
    const repository: ConnectedRepository = {
      id,
      name: redactText(input.name).slice(0, 200),
      provider: input.provider ?? existing?.provider ?? 'github',
      defaultBranch: redactText(input.defaultBranch ?? existing?.defaultBranch ?? 'main').slice(
        0,
        100,
      ),
      visibility: input.visibility ?? existing?.visibility ?? 'unknown',
      connectedAt: existing?.connectedAt ?? now,
      lastActivityAt: existing?.lastActivityAt ?? null,
      settings: mergeSettings(existing?.settings, input.settings),
    };
    this.repositories.set(id, repository);
    this.emit('repository', id);
    return cloneRepository(repository);
  }

  updateRepositorySettings(id: string, patch: Partial<RepositorySettings>): ConnectedRepository {
    const existing = this.requireRepository(id);
    existing.settings = mergeSettings(existing.settings, patch);
    this.emit('repository', id);
    return cloneRepository(existing);
  }

  disconnectRepository(id: string): boolean {
    const deleted = this.repositories.delete(id);
    if (deleted) {
      for (const [runId, run] of this.runs) {
        if (run.repositoryId === id) this.runs.delete(runId);
      }
      this.activities = this.activities.filter((a) => this.runs.has(a.runId));
      this.emit('repository', id);
    }
    return deleted;
  }

  createRun(input: {
    id?: string;
    repositoryId: string;
    request: string;
    agent: string;
    model?: string | null;
  }): AgentRun {
    const repository = this.requireRepository(input.repositoryId);
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: safeId(input.id ?? randomUUID()),
      repositoryId: repository.id,
      request: redactText(input.request).slice(0, 2000),
      agent: redactText(input.agent).slice(0, 100),
      model: input.model ? redactText(input.model).slice(0, 100) : null,
      status: 'queued',
      stage: 'Queued',
      summary: null,
      output: null,
      costUsd: 0,
      startedAt: now,
      finishedAt: null,
      approval: emptyApproval(),
    };
    this.runs.set(run.id, run);
    repository.lastActivityAt = now;
    this.emit('run', run.id);
    return cloneRun(run);
  }

  updateRun(
    id: string,
    patch: Partial<
      Pick<AgentRun, 'status' | 'stage' | 'summary' | 'output' | 'costUsd' | 'finishedAt'>
    >,
  ): AgentRun {
    const run = this.requireRun(id);
    if (patch.status !== undefined) run.status = patch.status;
    if (patch.stage !== undefined) run.stage = redactText(patch.stage).slice(0, 200);
    if (patch.summary !== undefined) run.summary = nullableRedacted(patch.summary, 4000);
    if (patch.output !== undefined) run.output = nullableRedacted(patch.output, 8000);
    if (patch.costUsd !== undefined) run.costUsd = Math.max(0, finite(patch.costUsd));
    if (patch.finishedAt !== undefined) run.finishedAt = patch.finishedAt;
    if (isTerminal(run.status) && !run.finishedAt) run.finishedAt = new Date().toISOString();
    const repository = this.requireRepository(run.repositoryId);
    repository.lastActivityAt = new Date().toISOString();
    this.emit('run', id);
    return cloneRun(run);
  }

  appendActivity(input: {
    runId: string;
    kind: ActivityKind;
    title: string;
    detail?: string;
    at?: string;
  }): AgentActivity {
    const run = this.requireRun(input.runId);
    const activity: AgentActivity = {
      id: randomUUID(),
      runId: run.id,
      at: input.at ?? new Date().toISOString(),
      kind: input.kind,
      title: redactText(input.title).slice(0, 300),
      detail: redactText(input.detail ?? '').slice(0, 8000),
    };
    this.activities.push(activity);
    if (this.activities.length > 10_000) this.activities.splice(0, this.activities.length - 10_000);
    const repository = this.requireRepository(run.repositoryId);
    repository.lastActivityAt = activity.at;
    this.emit('activity', activity.id);
    return { ...activity };
  }

  requestApproval(runId: string, note?: string): AgentRun {
    const run = this.requireRun(runId);
    run.status = 'waiting-approval';
    run.stage = 'Waiting for approval';
    run.approval = {
      status: 'pending',
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      note: note ? redactText(note).slice(0, 1000) : null,
    };
    this.emit('approval', runId);
    return cloneRun(run);
  }

  decideApproval(runId: string, approved: boolean, actor: string, note?: string): AgentRun {
    const run = this.requireRun(runId);
    if (run.approval.status !== 'pending') throw new Error(`Run ${runId} has no pending approval.`);
    run.approval = {
      ...run.approval,
      status: approved ? 'approved' : 'rejected',
      decidedAt: new Date().toISOString(),
      decidedBy: redactText(actor).slice(0, 200),
      note: note ? redactText(note).slice(0, 1000) : run.approval.note,
    };
    run.status = approved ? 'running' : 'stopped';
    run.stage = approved ? 'Approval granted' : 'Stopped by reviewer';
    if (!approved) run.finishedAt = new Date().toISOString();
    this.emit('approval', runId);
    return cloneRun(run);
  }

  private requireRepository(id: string): ConnectedRepository {
    const repository = this.repositories.get(id);
    if (!repository) throw new Error(`Unknown repository: ${id}`);
    return repository;
  }

  private requireRun(id: string): AgentRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Unknown run: ${id}`);
    return run;
  }

  private emit(type: ControlPlaneEvent['type'], entityId: string): void {
    const event = { type, entityId, at: new Date().toISOString() };
    for (const listener of this.listeners) listener(event);
  }
}

function mergeSettings(
  current?: RepositorySettings,
  patch?: Partial<RepositorySettings>,
): RepositorySettings {
  const base = current ?? DEFAULT_SETTINGS;
  return {
    benchmarkCommand: nullableRedacted(patch?.benchmarkCommand ?? base.benchmarkCommand, 1000),
    testCommand: nullableRedacted(patch?.testCommand ?? base.testCommand, 1000),
    buildCommand: nullableRedacted(patch?.buildCommand ?? base.buildCommand, 1000),
    protectedPaths: cleanList(patch?.protectedPaths ?? base.protectedPaths),
    writablePaths: cleanList(patch?.writablePaths ?? base.writablePaths),
    allowedAgents: cleanList(patch?.allowedAgents ?? base.allowedAgents),
    maxCostUsd: Math.max(0.01, finite(patch?.maxCostUsd ?? base.maxCostUsd)),
    requireApprovalForPr: patch?.requireApprovalForPr ?? base.requireApprovalForPr,
    retentionDays: Math.max(1, Math.round(finite(patch?.retentionDays ?? base.retentionDays))),
  };
}

function cleanList(values: string[]): string[] {
  return values.slice(0, 100).map((value) => redactText(String(value)).slice(0, 300));
}

function nullableRedacted(value: string | null, max: number): string | null {
  return value == null ? null : redactText(String(value)).slice(0, max);
}

function safeId(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 200) || randomUUID();
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function isTerminal(status: RunStatus): boolean {
  return ['completed', 'rejected', 'failed', 'stopped'].includes(status);
}

function emptyApproval(): ApprovalState {
  return {
    status: 'not-requested',
    requestedAt: null,
    decidedAt: null,
    decidedBy: null,
    note: null,
  };
}

function cloneRepository(repository: ConnectedRepository): ConnectedRepository {
  return {
    ...repository,
    settings: {
      ...repository.settings,
      protectedPaths: [...repository.settings.protectedPaths],
      writablePaths: [...repository.settings.writablePaths],
      allowedAgents: [...repository.settings.allowedAgents],
    },
  };
}

function cloneRun(run: AgentRun): AgentRun {
  return { ...run, approval: { ...run.approval } };
}
