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
  /** Serializes appendFile calls — parallel experiments append concurrently,
   * and unserialized writes can land in the file out of sequence order. */
  private writeChain: Promise<unknown> = Promise.resolve();
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
    const write = this.writeChain.then(() =>
      appendFile(this.eventsPath, `${JSON.stringify(envelope)}\n`, 'utf8'),
    );
    this.writeChain = write.catch(() => {});
    await write;
    for (const fn of this.listeners) fn(envelope);
    return envelope;
  }

  /**
   * Reads every complete event. A torn final line (crash mid-append) is
   * dropped; anything torn earlier than the tail means real corruption and
   * raises instead of silently losing accepted work. Every envelope is
   * shape-validated and version-migrated before replay.
   */
  async readAll(): Promise<EventEnvelope[]> {
    const raw = await readFile(this.eventsPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const envelopes: EventEnvelope[] = [];
    for (let i = 0; i < lines.length; i++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[i] as string);
      } catch (err) {
        if (i === lines.length - 1) break;
        throw new Error(
          `Event log ${this.eventsPath} is corrupt at line ${i + 1} (not the tail): ${(err as Error).message}`,
        );
      }
      envelopes.push(migrateEnvelope(validateEnvelope(parsed, this.eventsPath, i + 1)));
    }
    // Logs written before appends were serialized may hold adjacent events in
    // swapped file order; sequence numbers are authoritative, file order is not.
    envelopes.sort((a, b) => a.seq - b.seq);
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

function validateEnvelope(parsed: unknown, file: string, line: number): EventEnvelope {
  const env = parsed as Partial<EventEnvelope> | null;
  if (
    !env ||
    typeof env.v !== 'number' ||
    typeof env.seq !== 'number' ||
    typeof env.at !== 'string' ||
    typeof env.event?.type !== 'string'
  ) {
    throw new Error(`Event log ${file} line ${line} is not a valid event envelope.`);
  }
  return env as EventEnvelope;
}

/**
 * Migration registry: ENVELOPE_MIGRATIONS[v] upgrades a v-schema envelope to
 * v+1. Empty at version 1 — bumping EVENT_SCHEMA_VERSION now requires adding
 * a migration here instead of silently breaking old runs.
 */
const ENVELOPE_MIGRATIONS: Record<number, (env: EventEnvelope) => EventEnvelope> = {};

function migrateEnvelope(env: EventEnvelope): EventEnvelope {
  let current = env;
  if (current.v > EVENT_SCHEMA_VERSION) {
    throw new Error(
      `Event log entry has schema version ${current.v} (this paxcli reads up to ${EVENT_SCHEMA_VERSION}). Upgrade paxcli to read this run.`,
    );
  }
  while (current.v < EVENT_SCHEMA_VERSION) {
    const migrate = ENVELOPE_MIGRATIONS[current.v];
    if (!migrate) {
      throw new Error(
        `Event log entry has schema version ${current.v} and no migration to ${EVENT_SCHEMA_VERSION} exists.`,
      );
    }
    current = migrate(current);
  }
  return current;
}

/** Terminal event shared by both engines: interrupted wins over finished. */
export async function appendTerminalEvent(
  store: EventStore,
  params: { aborted: boolean; reason: string; bestNodeId: string | null },
): Promise<void> {
  if (params.aborted) {
    await store.append({ type: 'run_interrupted', at: new Date().toISOString() });
  } else {
    await store.append({
      type: 'run_finished',
      reason: params.reason,
      bestNodeId: params.bestNodeId,
      finishedAt: new Date().toISOString(),
    });
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
    reproduction: null,
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
      case 'winner_reproduced':
        summary.reproduction = {
          nodeId: event.nodeId,
          held: event.held,
          display: event.display,
        };
        break;
      case 'run_finished':
        summary.finished = true;
        summary.finishReason = event.reason;
        summary.bestNodeId = event.bestNodeId;
        break;
      case 'run_interrupted':
        break;
      default: {
        // Exhaustiveness guard: a new EngineEvent type must add a case here,
        // or replay silently drops it (this is exactly how reproduction
        // evidence got lost once).
        const unhandled: never = event;
        void unhandled;
        break;
      }
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
      if (existing.pid !== process.pid && (await lockHolderAlive(existing))) {
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

/**
 * A live PID alone is not proof the lock holder is running — PIDs recycle
 * fast on Windows. A process that started AFTER the lock was written cannot
 * be the writer, so the lock is stale. When the OS start time is unavailable
 * the check stays conservative: alive PID = lock held.
 */
async function lockHolderAlive(info: LockInfo): Promise<boolean> {
  if (!isProcessAlive(info.pid)) return false;
  const started = await processStartTime(info.pid);
  if (started === null) return true;
  const lockTime = Date.parse(info.startedAt);
  if (Number.isNaN(lockTime)) return true;
  // 5s slack: lockTime is stamped after process start, and clock precision differs.
  return started.getTime() <= lockTime + 5000;
}

async function processStartTime(pid: number): Promise<Date | null> {
  try {
    const { execa } = await import('execa');
    if (process.platform === 'win32') {
      const { stdout } = await execa('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
      ]);
      const parsed = new Date(String(stdout).trim());
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const { stdout } = await execa('ps', ['-o', 'lstart=', '-p', String(pid)]);
    const raw = String(stdout).trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
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
