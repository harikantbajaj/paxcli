/**
 * Core domain types for the experiment tree.
 *
 * Verification is graded, never binary. A result is "Measured" the moment it
 * beats the local benchmark and climbs grades only as stronger evidence lands.
 */

export type VerificationGrade =
  | 'measured'
  | 'validated'
  | 'equivalent'
  | 'reproduced'
  | 'production-confirmed';

export type NodeStatus = 'pending' | 'running' | 'evaluating' | 'accepted' | 'rejected' | 'failed';

export type MetricDirection = 'minimize' | 'maximize';

export interface Score {
  metric: string;
  value: number;
  direction: MetricDirection;
  /** Raw sample values the summary was computed from. */
  samples: number[];
  /** Additional named measurements (e.g. memory peak) for constraints. */
  secondary?: Record<string, number>;
}

export interface GateResult {
  gateId: string;
  name: string;
  pass: boolean;
  exitCode: number | null;
  durationMs: number;
  stdoutTail: string;
}

export interface AgentRunSummary {
  hostId: string;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  exitReason: 'completed' | 'timeout' | 'cancelled' | 'error' | 'budget';
}

export interface ExperimentNode {
  id: string;
  parentId: string | null;
  depth: number;
  branch: string;
  commitSha: string | null;
  hypothesis: string;
  status: NodeStatus;
  score: Score | null;
  grade: VerificationGrade | null;
  gateResults: GateResult[];
  agentRun: AgentRunSummary | null;
  /** Plain-English reason shown to users ("Rejected: increased memory by 17%"). */
  decisionReason: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Insight {
  id: string;
  kind: 'rejected_hypothesis' | 'failure_pattern' | 'annotation';
  text: string;
  nodeId: string | null;
  round: number;
  createdAt: string;
}

/** Schema version for the event log. Bump only with a migration. */
export const EVENT_SCHEMA_VERSION = 1;

export type EngineEvent =
  | {
      type: 'run_started';
      runId: string;
      baseSha: string;
      baseBranch: string;
      configHash: string;
      policyHash: string;
      startedAt: string;
    }
  | { type: 'baseline_measured'; score: Score; noiseFloorPct: number }
  | { type: 'round_started'; round: number }
  | { type: 'node_created'; node: ExperimentNode }
  | { type: 'node_updated'; nodeId: string; patch: Partial<ExperimentNode> }
  | { type: 'insight_added'; insight: Insight }
  | { type: 'cost_recorded'; nodeId: string; costUsd: number }
  | { type: 'run_finished'; reason: string; bestNodeId: string | null; finishedAt: string }
  | { type: 'run_interrupted'; at: string };

export interface EventEnvelope {
  v: number;
  seq: number;
  at: string;
  event: EngineEvent;
}

export interface RunSummary {
  runId: string;
  baseSha: string;
  baseBranch: string;
  baseline: Score | null;
  noiseFloorPct: number | null;
  nodes: Map<string, ExperimentNode>;
  insights: Insight[];
  totalCostUsd: number;
  finished: boolean;
  finishReason: string | null;
  bestNodeId: string | null;
  round: number;
}

export function betterThan(a: number, b: number, direction: MetricDirection): boolean {
  return direction === 'minimize' ? a < b : a > b;
}

export function improvementPct(
  candidate: number,
  baseline: number,
  direction: MetricDirection,
): number {
  if (baseline === 0) return 0;
  const delta = ((baseline - candidate) / Math.abs(baseline)) * 100;
  return direction === 'minimize' ? delta : -delta;
}
