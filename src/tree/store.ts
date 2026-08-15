import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EVENT_SCHEMA_VERSION,
  type EngineEvent,
  type EventEnvelope,
  type ExperimentNode,
  type RunSummary,
} from './types.js';

/**
 * Append-only JSONL event store. The events file is the source of truth;
 * everything else (tree state, summaries) is a reduction over it, which makes
 * crash recovery a replay and `paxcli resume` trivial to trust.
 *
 * Single-writer: the engine process holds a lock identified by PID plus
 * process start time — PID alone is unsafe on Windows where PIDs recycle fast.
 */

export function paxcliDir(repoRoot: string): string {
  return path.join(repoRoot, '.paxcli');
}

export function runDir(repoRoot: string, id: string): string {
  return path.join(paxcliDir(repoRoot), 'runs', id);
}

export class EventStore {
  private seq = 0;
  private listeners = new Set<(e: EventEnvelope) => void>();
  readonly eventsPath: string;

  private constructor(readonly dir: string) {
    this.eventsPath = path.join(dir, 'events.jsonl');
  }

  static async create(repoRoot: string, id: string): Promise<EventStore> {
    const dir = runDir(repoRoot, id);
    await mkdir(path.join(dir, 'traces'), { recursive: true });
    await mkdir(path.join(dir, 'receipts'), { recursive: true });
    return new EventStore(dir);
  }

  static async open(repoRoot: string, id: string): Promise<EventStore> {
    const store = new EventStore(runDir(repoRoot, id));
    if (!existsSync(store.eventsPath)) {
      throw new Error(`Run ${id} has no event log at ${store.eventsPath}`);
    }
    const envelopes = await store.readAll();
    store.seq = envelopes.length > 0 ? (envelopes[envelopes.length - 1] as EventEnvelope).seq : 0;
    return store;
  }

  static async listRuns(repoRoot: string): Promise<string[]> {
    const dir = path.join(paxcliDir(repoRoot), 'runs');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  subscribe(fn: (e: EventEnvelope) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async append(event: EngineEvent): Promise<EventEnvelope> {
    this.seq += 1;
    const envelope: EventEnvelope = {
      v: EVENT_SCHEMA_VERSION,
      seq: this.seq,
      at: new Date().toISOString(),
      event,
    };
    await appendFile(this.eventsPath, `${JSON.stringify(envelope)}\n`, 'utf8');
    for (const fn of this.listeners) fn(envelope);
    return envelope;
  }

  /**
   * Reads every complete event. A torn final line (crash mid-append) is
   * dropped; anything torn earlier than the tail means real corruption and
   * raises instead of silently losing accepted work.
   */
  async readAll(): Promise<EventEnvelope[]> {
    const raw = await readFile(this.eventsPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const envelopes: EventEnvelope[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        envelopes.push(JSON.parse(lines[i] as string) as EventEnvelope);
      } catch (err) {
        if (i === lines.length - 1) break;
        throw new Error(
          `Event log ${this.eventsPath} is corrupt at line ${i + 1} (not the tail): ${(err as Error).message}`,
        );
      }
    }
    let prev = 0;
    for (const env of envelopes) {
      if (env.seq !== prev + 1) {
        throw new Error(
          `Event log ${this.eventsPath} has a sequence gap: expected ${prev + 1}, found ${env.seq}`,
        );
      }
      prev = env.seq;
    }
    return envelopes;
  }

  async replay(): Promise<RunSummary> {
    return reduceEvents(await this.readAll());
  }

  tracesDir(nodeId: string): string {
    return path.join(this.dir, 'traces', nodeId);
  }

  receiptsDir(): string {
    return path.join(this.dir, 'receipts');
  }
}

export function reduceEvents(envelopes: EventEnvelope[]): RunSummary {
  const summary: RunSummary = {
    runId: '',
    baseSha: '',
    baseBranch: '',
    baseline: null,
    noiseFloorPct: null,
    nodes: new Map<string, ExperimentNode>(),
    insights: [],
    totalCostUsd: 0,
    finished: false,
    finishReason: null,
    bestNodeId: null,
    round: 0,
  };
  for (const { event } of envelopes) {
    switch (event.type) {
      case 'run_started':
        summary.runId = event.runId;
        summary.baseSha = event.baseSha;
        summary.baseBranch = event.baseBranch;
        break;
      case 'baseline_measured':
        summary.baseline = event.score;
        summary.noiseFloorPct = event.noiseFloorPct;
        break;
      case 'round_started':
        summary.round = event.round;
        break;
      case 'node_created':
        summary.nodes.set(event.node.id, { ...event.node });
        break;
      case 'node_updated': {
        const node = summary.nodes.get(event.nodeId);
        if (node) Object.assign(node, event.patch);
        break;
      }
      case 'insight_added':
        summary.insights.push(event.insight);
        break;
      case 'cost_recorded':
        summary.totalCostUsd += event.costUsd;
        break;
      case 'run_finished':
        summary.finished = true;
        summary.finishReason = event.reason;
        summary.bestNodeId = event.bestNodeId;
        break;
      case 'run_interrupted':
        break;
    }
  }
  return summary;
}

interface LockInfo {
  pid: number;
  /** Rough process identity beyond the PID: start timestamp captured at lock time. */
  startedAt: string;
}

export class EngineLock {
  private constructor(private readonly lockPath: string) {}

  static async acquire(dir: string): Promise<EngineLock> {
    const lockPath = path.join(dir, 'engine.lock');
    if (existsSync(lockPath)) {
      const existing = JSON.parse(await readFile(lockPath, 'utf8')) as LockInfo;
      if (isProcessAlive(existing.pid)) {
        throw new Error(
          `Another Paxcli engine (pid ${existing.pid}) already owns this run. ` +
            `If that process is gone, delete ${lockPath} and retry.`,
        );
      }
    }
    const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
    await writeFile(lockPath, JSON.stringify(info), 'utf8');
    return new EngineLock(lockPath);
  }

  async release(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
