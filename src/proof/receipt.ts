import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Comparison } from '../bench/stats.js';
import type {
  AgentRunSummary,
  ExperimentNode,
  GateResult,
  Score,
  VerificationGrade,
} from '../tree/types.js';

/**
 * Experiment receipt: the reproducible evidence behind an accepted (or
 * rejected) result. Written per node; the winner's receipt travels with the
 * branch, the PR, and the report.
 */
export interface Receipt {
  receiptVersion: 1;
  runId: string;
  nodeId: string;
  grade: VerificationGrade | null;
  decision: 'accepted' | 'rejected' | 'failed';
  decisionReason: string;
  hypothesis: string;
  baseCommit: string;
  finalCommit: string | null;
  agent: AgentRunSummary | null;
  baseline: Score | null;
  candidate: Score | null;
  comparison: {
    improvementPct: number;
    noiseFloorPct: number;
    requiredPct: number;
    ci95: [number, number] | null;
    effectSize: number | null;
    display: string;
  } | null;
  gates: GateResult[];
  pinsVerified: boolean;
  /** Suspicion-level detector findings: risks a human reviewer should check. */
  risks: string[];
  withheld: { configured: boolean; pass: boolean; category: string | null } | null;
  /** Fresh-workspace re-verification of the winner, when performed. */
  reproduction: { held: boolean; display: string } | null;
  environment: {
    os: string;
    arch: string;
    node: string;
  };
  configHash: string;
  createdAt: string;
  reproduceCmd: string;
}

export const RECEIPT_VERSION = 1;

const scoreSchema = z.object({
  metric: z.string(),
  value: z.number(),
  direction: z.enum(['minimize', 'maximize']),
  samples: z.array(z.number()),
  secondary: z.record(z.number()).optional(),
});

/** Mirrors the Receipt interface — receipts are validated on every read. */
export const receiptSchema = z.object({
  receiptVersion: z.literal(1),
  runId: z.string(),
  nodeId: z.string(),
  grade: z
    .enum(['measured', 'validated', 'equivalent', 'reproduced', 'production-confirmed'])
    .nullable(),
  decision: z.enum(['accepted', 'rejected', 'failed']),
  decisionReason: z.string(),
  hypothesis: z.string(),
  baseCommit: z.string(),
  finalCommit: z.string().nullable(),
  agent: z
    .object({
      hostId: z.string(),
      model: z.string().nullable(),
      costUsd: z.number().nullable(),
      tokensIn: z.number().nullable(),
      tokensOut: z.number().nullable(),
      durationMs: z.number(),
      exitReason: z.enum(['completed', 'timeout', 'cancelled', 'error', 'budget']),
    })
    .nullable(),
  baseline: scoreSchema.nullable(),
  candidate: scoreSchema.nullable(),
  comparison: z
    .object({
      improvementPct: z.number(),
      noiseFloorPct: z.number(),
      requiredPct: z.number(),
      ci95: z.tuple([z.number(), z.number()]).nullable(),
      effectSize: z.number().nullable(),
      display: z.string(),
    })
    .nullable(),
  gates: z.array(
    z.object({
      gateId: z.string(),
      name: z.string(),
      pass: z.boolean(),
      exitCode: z.number().nullable(),
      durationMs: z.number(),
      stdoutTail: z.string(),
    }),
  ),
  pinsVerified: z.boolean(),
  risks: z.array(z.string()),
  withheld: z
    .object({ configured: z.boolean(), pass: z.boolean(), category: z.string().nullable() })
    .nullable(),
  reproduction: z.object({ held: z.boolean(), display: z.string() }).nullable(),
  environment: z.object({ os: z.string(), arch: z.string(), node: z.string() }),
  configHash: z.string(),
  createdAt: z.string(),
  reproduceCmd: z.string(),
});

/**
 * Migration registry: RECEIPT_MIGRATIONS[v] upgrades a v-shaped receipt to
 * v+1. Empty at version 1 — the machinery exists so bumping the version is a
 * migration away, never a silent format break.
 */
const RECEIPT_MIGRATIONS: Record<
  number,
  (raw: Record<string, unknown>) => Record<string, unknown>
> = {};

/** Validates (and, when needed, migrates) a receipt read from disk. */
export function parseReceipt(raw: unknown, sourceLabel = 'receipt'): Receipt {
  let value = (raw ?? {}) as Record<string, unknown>;
  let version = typeof value.receiptVersion === 'number' ? value.receiptVersion : 0;
  if (version > RECEIPT_VERSION) {
    throw new Error(
      `${sourceLabel} was written by a newer paxcli (receiptVersion ${version} > ${RECEIPT_VERSION}). Upgrade paxcli to read it.`,
    );
  }
  while (version < RECEIPT_VERSION) {
    const migrate = RECEIPT_MIGRATIONS[version];
    if (!migrate) {
      throw new Error(
        `${sourceLabel} has unsupported receiptVersion ${version} and no migration to ${RECEIPT_VERSION} exists.`,
      );
    }
    value = migrate(value);
    version = typeof value.receiptVersion === 'number' ? value.receiptVersion : version + 1;
  }
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `${sourceLabel} failed validation (${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'unknown'}).`,
    );
  }
  // Cast bridges zod's `secondary?: T | undefined` and the interface's exact
  // optional (`secondary?: T`) — structurally identical, validated above.
  return parsed.data as Receipt;
}

export function buildReceipt(params: {
  runId: string;
  node: ExperimentNode;
  baseSha: string;
  baseline: Score | null;
  comparison: Comparison | null;
  pinsVerified: boolean;
  configHash: string;
  risks?: string[];
  withheld?: Receipt['withheld'];
  reproduction?: Receipt['reproduction'];
}): Receipt {
  const { runId, node, baseSha, baseline, comparison, pinsVerified, configHash } = params;
  return {
    receiptVersion: 1,
    runId,
    nodeId: node.id,
    grade: node.grade,
    decision:
      node.status === 'accepted' ? 'accepted' : node.status === 'failed' ? 'failed' : 'rejected',
    decisionReason: node.decisionReason ?? '',
    hypothesis: node.hypothesis,
    baseCommit: baseSha,
    finalCommit: node.commitSha,
    agent: node.agentRun,
    baseline,
    candidate: node.score,
    comparison: comparison
      ? {
          improvementPct: comparison.improvementPct,
          noiseFloorPct: comparison.noiseFloorPct,
          requiredPct: comparison.requiredPct,
          ci95: comparison.ci95,
          effectSize: comparison.effectSize,
          display: comparison.display,
        }
      : null,
    gates: node.gateResults,
    pinsVerified,
    risks: params.risks ?? [],
    withheld: params.withheld ?? null,
    reproduction: params.reproduction ?? null,
    environment: {
      os: `${process.platform} ${process.arch}`,
      arch: process.arch,
      node: process.version,
    },
    configHash,
    createdAt: new Date().toISOString(),
    reproduceCmd: `paxcli run reproduce ${node.id} --run ${runId}`,
  };
}

/** Writes the full receipt plus a redacted variant safe for sharing. */
export async function writeReceipt(receiptsDir: string, receipt: Receipt): Promise<string> {
  const file = path.join(receiptsDir, `${receipt.nodeId}.json`);
  await writeFile(file, JSON.stringify(receipt, null, 2), 'utf8');
  const { redactValue } = await import('./redact.js');
  const redacted = redactValue(receipt);
  await writeFile(
    path.join(receiptsDir, `${receipt.nodeId}.redacted.json`),
    JSON.stringify(redacted, null, 2),
    'utf8',
  );
  return file;
}
