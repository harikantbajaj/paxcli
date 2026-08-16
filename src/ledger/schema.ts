import { z } from 'zod';
import type { TaskOutcome } from '../engine/task-loop.js';
import type { Receipt } from '../proof/receipt.js';
import { redactValue } from '../proof/redact.js';

/**
 * The Proof Ledger: a committable, append-only record of verified changes
 * that paxcli leaves in the user's repository (PROOF.md by default). Every
 * entry is human-readable markdown backed by an embedded machine-readable
 * JSON block validated by these schemas.
 *
 * Honest labels are enforced at the type level: optimization entries carry
 * the verified vocabulary (grade ladder); task entries can only ever say
 * "checks passed" or "applied — not verified by paxcli".
 */

export const LEDGER_ENTRY_VERSION = 1;

const gateRowSchema = z.object({
  name: z.string(),
  pass: z.boolean(),
});

export const optimizationEntrySchema = z.object({
  ledgerEntryVersion: z.literal(1),
  kind: z.literal('optimization'),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  recordedAt: z.string().min(1),
  hypothesis: z.string(),
  grade: z
    .enum(['measured', 'validated', 'equivalent', 'reproduced', 'production-confirmed'])
    .nullable(),
  metric: z.string().nullable(),
  improvementPct: z.number().nullable(),
  noiseFloorPct: z.number().nullable(),
  /** Human display of the measurement, e.g. "51.0 → 7.0 (−86.9%, noise ±5%)". */
  display: z.string().nullable(),
  gates: z.array(gateRowSchema),
  /** null = withheld cases were not configured for this run. */
  withheldPassed: z.boolean().nullable(),
  /** null = fresh reproduction was not performed. */
  reproductionHeld: z.boolean().nullable(),
  pinsVerified: z.boolean(),
  risks: z.array(z.string()),
  costUsd: z.number().nullable(),
  baseCommit: z.string(),
  finalCommit: z.string().nullable(),
  reproduceCmd: z.string(),
});

export const TASK_LABEL_CHECKED = 'checks passed';
export const TASK_LABEL_UNCHECKED = 'applied — not verified by paxcli';

export const taskEntrySchema = z.object({
  ledgerEntryVersion: z.literal(1),
  kind: z.literal('task'),
  runId: z.string().min(1),
  recordedAt: z.string().min(1),
  /** Agent's one-line description of the change. */
  summary: z.string(),
  /** The only two claims a task entry may make. Never "faster" or "better". */
  label: z.enum([TASK_LABEL_CHECKED, TASK_LABEL_UNCHECKED]),
  changedFiles: z.array(z.string()),
  checks: z.array(z.object({ name: z.string(), cmd: z.string(), pass: z.boolean() })),
  suspicions: z.array(z.string()),
  costUsd: z.number().nullable(),
  snapshotCommit: z.string().nullable(),
  resultCommit: z.string().nullable(),
});

export const ledgerEntrySchema = z.discriminatedUnion('kind', [
  optimizationEntrySchema,
  taskEntrySchema,
]);

export type OptimizationEntry = z.infer<typeof optimizationEntrySchema>;
export type TaskEntry = z.infer<typeof taskEntrySchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/** Stable identity used for idempotent appends. */
export function entryKey(entry: LedgerEntry): string {
  return entry.kind === 'optimization'
    ? `optimization:${entry.runId}:${entry.nodeId}`
    : `task:${entry.runId}`;
}

/**
 * Projects a receipt into a ledger entry. Pass the REDACTED receipt variant;
 * the projection redacts again defensively and drops raw command output
 * (gate stdout tails never reach the repo-committed file).
 */
export function entryFromReceipt(
  receipt: Receipt,
  recordedAt = new Date().toISOString(),
): OptimizationEntry {
  const entry: OptimizationEntry = {
    ledgerEntryVersion: LEDGER_ENTRY_VERSION,
    kind: 'optimization',
    runId: receipt.runId,
    nodeId: receipt.nodeId,
    recordedAt,
    hypothesis: receipt.hypothesis,
    grade: receipt.grade,
    metric: receipt.baseline?.metric ?? null,
    improvementPct: receipt.comparison?.improvementPct ?? null,
    noiseFloorPct: receipt.comparison?.noiseFloorPct ?? null,
    display: receipt.comparison?.display ?? null,
    gates: receipt.gates.map((g) => ({ name: g.name, pass: g.pass })),
    withheldPassed: receipt.withheld?.configured ? receipt.withheld.pass : null,
    reproductionHeld: receipt.reproduction ? receipt.reproduction.held : null,
    pinsVerified: receipt.pinsVerified,
    risks: receipt.risks,
    costUsd: receipt.agent?.costUsd ?? null,
    baseCommit: receipt.baseCommit,
    finalCommit: receipt.finalCommit,
    reproduceCmd: receipt.reproduceCmd,
  };
  return redactValue(entry);
}

/** Projects a successful, applied task outcome into a ledger entry. */
export function entryFromTaskOutcome(
  outcome: TaskOutcome,
  recordedAt = new Date().toISOString(),
): TaskEntry {
  const entry: TaskEntry = {
    ledgerEntryVersion: LEDGER_ENTRY_VERSION,
    kind: 'task',
    runId: outcome.runId,
    recordedAt,
    summary: outcome.summary,
    label: outcome.checksSkipped ? TASK_LABEL_UNCHECKED : TASK_LABEL_CHECKED,
    changedFiles: outcome.changedFiles,
    checks: outcome.checks.map((c) => ({ name: c.name, cmd: c.cmd, pass: c.pass })),
    suspicions: outcome.suspicions,
    costUsd: outcome.totalCostUsd > 0 ? outcome.totalCostUsd : null,
    snapshotCommit: outcome.snapshotSha,
    resultCommit: outcome.resultSha,
  };
  return redactValue(entry);
}
