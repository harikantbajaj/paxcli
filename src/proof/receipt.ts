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
    display: string;
  } | null;
  gates: GateResult[];
  pinsVerified: boolean;
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
          display: comparison.display,
        }
      : null,
    gates: node.gateResults,
    pinsVerified,
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

export async function writeReceipt(receiptsDir: string, receipt: Receipt): Promise<string> {
  const file = path.join(receiptsDir, `${receipt.nodeId}.json`);
  await writeFile(file, JSON.stringify(receipt, null, 2), 'utf8');
  return file;
}
