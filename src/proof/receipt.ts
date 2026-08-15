import { writeFile } from 'node:fs/promises';
import path from 'node:path';
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
