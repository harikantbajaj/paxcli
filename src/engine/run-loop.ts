import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BenchmarkHarness } from '../bench/harness.js';
import { type Comparison, compare } from '../bench/stats.js';
import { type PaxcliConfig, configHash } from '../config/schema.js';
import { runGates } from '../gates/engine.js';
import type { HostAdapter } from '../hosts/types.js';
import { buildAgentEnv } from '../policy/env.js';
import { type PinSet, capturePins, verifyPins } from '../proof/pins.js';
import { type Receipt, buildReceipt, writeReceipt } from '../proof/receipt.js';
import { EngineLock, EventStore } from '../tree/store.js';
import {
  type ExperimentNode,
  type Insight,
  type Score,
  betterThan,
  improvementPct,
} from '../tree/types.js';
import { runId as newRunId, shortId } from '../util/ids.js';
import { WorktreeBackend, snapshotRepo, unexpectedMainRepoChanges } from '../worktree/local.js';
import { buildExperimentPrompt, extractHypothesis } from './prompt.js';

export interface RunOptions {
  repoRoot: string;
  config: PaxcliConfig;
  host: HostAdapter;
  signal: AbortSignal;
  onStatus: (msg: string) => void;
  /** Resume an existing run instead of starting fresh. */
  resumeRunId?: string;
}

export interface RunOutcome {
  runId: string;
  reason: string;
  bestNode: ExperimentNode | null;
  baseline: Score | null;
  totalCostUsd: number;
  receipts: Receipt[];
  nodesTried: number;
}

/**
 * The optimize loop. Best-first tree search over experiments:
 * each round branches from the best accepted node (or the baseline), runs
 * parallel agent experiments in isolated worktrees, and evaluates each one
 * deterministically — pins first, then benchmark, then gates and constraints.
 * The evaluator is engine code; no agent ever judges its own work.
 */
export async function runOptimize(opts: RunOptions): Promise<RunOutcome> {
  const { repoRoot, config, host, signal, onStatus } = opts;
  const startedAt = Date.now();
  const cfgHash = configHash(config);
  const backend = new WorktreeBackend(repoRoot);

  const detection = await host.detect();
  if (!detection.found) throw new Error(detection.problem ?? `Host "${host.id}" not available`);

  const snapshot = await snapshotRepo(repoRoot);
  const id = opts.resumeRunId ?? newRunId();
  const store = opts.resumeRunId
    ? await EventStore.open(repoRoot, id)
    : await EventStore.create(repoRoot, id);
  const lock = await EngineLock.acquire(store.dir);

  const receipts: Receipt[] = [];
  let reason = 'completed';

  try {
    // ---- Bootstrap or resume state ---------------------------------------
    let summary = opts.resumeRunId ? await store.replay() : null;
    if (summary?.finished) {
      throw new Error(`Run ${id} already finished (${summary.finishReason}). Start a new run.`);
    }
    if (!summary) {
      await store.append({
        type: 'run_started',
        runId: id,
        baseSha: snapshot.headSha,
        baseBranch: snapshot.branch,
        configHash: cfgHash,
        policyHash: cfgHash,
        startedAt: new Date().toISOString(),
      });
    }

    onStatus('Capturing integrity pins for protected files');
    const pins = await capturePins(repoRoot, config.policy.protected);

    // ---- Baseline ---------------------------------------------------------
    let baseline = summary?.baseline ?? null;
    let noisePct = summary?.noiseFloorPct ?? null;
    if (!baseline) {
      onStatus('Measuring baseline stability');
      const baseWt = await backend.provision(`base-${shortId(4)}`, snapshot.headSha);
      try {
        const harness = new BenchmarkHarness(config.benchmark, {
          cwd: baseWt.path,
          onStatus,
        });
        const result = await harness.measure('baseline');
        if (!result.stability.ok) {
          throw new Error(
            `Baseline benchmark is not reliable enough to optimize against:\n  - ${result.stability.problems.join('\n  - ')}\nFix the benchmark first (more samples, less noise), then retry.`,
          );
        }
        baseline = result.score;
        noisePct = result.stability.cvPct;
        await store.append({
          type: 'baseline_measured',
          score: baseline,
          noiseFloorPct: result.stability.cvPct,
        });
      } finally {
        await baseWt.destroy({ keepBranch: false });
      }
    }
    onStatus(
      `Baseline: ${baseline.metric} = ${baseline.value.toFixed(2)} (noise ±${(noisePct ?? 0).toFixed(1)}%)`,
    );

    summary = await store.replay();
    let totalCost = summary.totalCostUsd;
    let nodesTried = [...summary.nodes.values()].filter((n) => n.status !== 'pending').length;
    let roundsWithoutImprovement = 0;

    const startRound = summary.round + 1;
    for (let round = startRound; round <= config.search.maxRounds; round++) {
      if (signal.aborted) {
        reason = 'interrupted';
        break;
      }
      if (nodesTried >= config.search.maxNodes) {
        reason = 'node limit reached';
        break;
      }
      if (totalCost >= config.budget.maxCostUsd) {
        reason = `budget limit reached ($${totalCost.toFixed(2)} of $${config.budget.maxCostUsd.toFixed(2)})`;
        break;
      }
      if (Date.now() - startedAt > config.budget.maxWallClockMs) {
        reason = 'wall-clock limit reached';
        break;
      }

      await store.append({ type: 'round_started', round });
      onStatus(`Round ${round} of ${config.search.maxRounds}`);

      const current = await store.replay();
      const best = pickBest(current.nodes, config);
      const parentRef = best?.branch ?? snapshot.headSha;
      const bestScore = best?.score ?? null;

      const parallel = Math.min(config.search.parallel, config.search.maxNodes - nodesTried);
      const experiments: Promise<void>[] = [];
      for (let k = 0; k < parallel; k++) {
        experiments.push(
          runOneExperiment({
            round,
            parent: best,
            parentRef,
            baseline,
            bestScore,
            insights: current.insights,
            pins,
            config,
            host,
            backend,
            store,
            repoRoot,
            baseSha: snapshot.headSha,
            cfgHash,
            signal,
            onStatus,
            onCost: (c) => {
              totalCost += c;
            },
            onReceipt: (r) => receipts.push(r),
          }),
        );
        nodesTried += 1;
      }
      await Promise.all(experiments);

      const after = await store.replay();
      const newBest = pickBest(after.nodes, config);
      const improved =
        newBest &&
        (!best ||
          (newBest.score &&
            best.score &&
            betterThan(newBest.score.value, best.score.value, config.benchmark.direction)));
      roundsWithoutImprovement = improved ? 0 : roundsWithoutImprovement + 1;
      if (roundsWithoutImprovement >= config.search.plateauRounds) {
        reason = `plateau: no improvement for ${roundsWithoutImprovement} rounds`;
        break;
      }

      const drift = await unexpectedMainRepoChanges(repoRoot, snapshot);
      if (drift.length > 0) {
        onStatus(
          `Note: your main working tree changed during the run (${drift.length} file(s)). Experiments still branch from the original snapshot.`,
        );
      }
    }

    if (signal.aborted) reason = 'interrupted';

    const finalSummary = await store.replay();
    const bestNode = pickBest(finalSummary.nodes, config);
    if (signal.aborted) {
      await store.append({ type: 'run_interrupted', at: new Date().toISOString() });
    } else {
      await store.append({
        type: 'run_finished',
        reason,
        bestNodeId: bestNode?.id ?? null,
        finishedAt: new Date().toISOString(),
      });
    }

    return {
      runId: id,
      reason,
      bestNode,
      baseline,
      totalCostUsd: totalCost,
      receipts,
      nodesTried,
    };
  } finally {
    await backend.sweep().catch(() => {});
    await lock.release();
  }
}

function pickBest(nodes: Map<string, ExperimentNode>, config: PaxcliConfig): ExperimentNode | null {
  let best: ExperimentNode | null = null;
  for (const node of nodes.values()) {
    if (node.status !== 'accepted' || !node.score) continue;
    if (
      !best ||
      !best.score ||
      betterThan(node.score.value, best.score.value, config.benchmark.direction)
    ) {
      best = node;
    }
  }
  return best;
}

interface ExperimentContext {
  round: number;
  parent: ExperimentNode | null;
  parentRef: string;
  baseline: Score;
  bestScore: Score | null;
  insights: Insight[];
  pins: PinSet;
  config: PaxcliConfig;
  host: HostAdapter;
  backend: WorktreeBackend;
  store: EventStore;
  repoRoot: string;
  baseSha: string;
  cfgHash: string;
  signal: AbortSignal;
  onStatus: (msg: string) => void;
  onCost: (costUsd: number) => void;
  onReceipt: (r: Receipt) => void;
}

async function runOneExperiment(ctx: ExperimentContext): Promise<void> {
  const { config, store, onStatus } = ctx;
  const nodeId = shortId(8);
  const now = new Date().toISOString();
  const node: ExperimentNode = {
    id: nodeId,
    parentId: ctx.parent?.id ?? null,
    depth: (ctx.parent?.depth ?? 0) + 1,
    branch: '',
    commitSha: null,
    hypothesis: '',
    status: 'pending',
    score: null,
    grade: null,
    gateResults: [],
    agentRun: null,
    decisionReason: null,
    createdAt: now,
    finishedAt: null,
  };

  const wt = await ctx.backend.provision(nodeId, ctx.parentRef);
  node.branch = wt.branch;
  await store.append({ type: 'node_created', node });

  const traceDir = store.tracesDir(nodeId);
  await mkdir(traceDir, { recursive: true });
  const logPath = path.join(traceDir, 'agent.jsonl');

  const update = async (patch: Partial<ExperimentNode>) => {
    Object.assign(node, patch);
    await store.append({ type: 'node_updated', nodeId, patch });
  };

  let comparison: Comparison | null = null;
  let pinsVerified = true;
  let keepBranch = false;

  try {
    await update({ status: 'running' });
    const prompt = buildExperimentPrompt({
      config,
      baseline: ctx.baseline,
      bestSoFar: ctx.bestScore,
      insights: ctx.insights,
    });

    const agentResult = await ctx.host.spawnAgent({
      prompt,
      cwd: wt.path,
      timeoutMs: config.budget.perAgentTimeoutMs,
      signal: ctx.signal,
      env: buildAgentEnv(config.policy),
      logPath,
      onStatus,
      ...(config.host.model ? { model: config.host.model } : {}),
    });

    if (agentResult.costUsd) {
      ctx.onCost(agentResult.costUsd);
      await store.append({ type: 'cost_recorded', nodeId, costUsd: agentResult.costUsd });
    }
    await update({
      hypothesis: extractHypothesis(agentResult.finalText),
      agentRun: {
        hostId: ctx.host.id,
        model: config.host.model ?? null,
        costUsd: agentResult.costUsd,
        tokensIn: agentResult.tokensIn,
        tokensOut: agentResult.tokensOut,
        durationMs: agentResult.durationMs,
        exitReason: agentResult.exitReason,
      },
    });

    if (!agentResult.ok) {
      await reject(`Agent did not complete (${agentResult.exitReason})`, 'failed');
      return;
    }

    onStatus(`Evaluating: ${node.hypothesis}`);
    await update({ status: 'evaluating' });

    // 1. Integrity pins — checked BEFORE any score exists.
    const violations = await verifyPins(wt.path, ctx.pins);
    if (violations.length > 0) {
      pinsVerified = false;
      const list = violations.map((v) => `${v.file} (${v.kind})`).join(', ');
      await reject(
        `Modified protected file(s): ${list}. This is auto-rejected regardless of score.`,
      );
      return;
    }

    const changed = await wt.changedFiles();
    if (changed.length === 0) {
      await reject('Agent made no code changes');
      return;
    }

    // 2. Benchmark.
    const harness = new BenchmarkHarness(config.benchmark, { cwd: wt.path, onStatus });
    let measure: Awaited<ReturnType<BenchmarkHarness['measure']>>;
    try {
      measure = await harness.measure(`experiment ${nodeId}`);
    } catch (err) {
      await reject(`Benchmark failed to run after the change: ${(err as Error).message}`);
      return;
    }

    comparison = compare(
      ctx.baseline.samples,
      measure.score.samples,
      config.benchmark.direction,
      config.search.minImprovementPct,
    );
    await update({ score: measure.score });

    // 3. Constraints on secondary metrics.
    for (const constraint of config.constraints) {
      const before = ctx.baseline.secondary?.[constraint.metric];
      const after = measure.secondaryMedians[constraint.metric];
      if (before === undefined || after === undefined || before === 0) continue;
      const incPct = ((after - before) / Math.abs(before)) * 100;
      if (incPct > constraint.maxIncreasePct) {
        await reject(
          `Increased ${constraint.metric} by ${incPct.toFixed(1)}% (limit ${constraint.maxIncreasePct}%)`,
        );
        return;
      }
    }

    // 4. Gates — tests, equivalence, invariants.
    const gateResults = await runGates(
      config.gates,
      wt.path,
      buildAgentEnv(config.policy),
      onStatus,
    );
    await update({ gateResults });
    const failed = gateResults.find((g) => !g.pass);
    if (failed) {
      await reject(`Gate "${failed.name}" failed — a faster wrong answer is still wrong`);
      return;
    }

    // 5. The improvement must clear the noise floor.
    const target = ctx.bestScore ?? ctx.baseline;
    const beatsTarget = betterThan(measure.score.value, target.value, config.benchmark.direction);
    if (!comparison.meaningful || !beatsTarget) {
      await reject(
        `No meaningful improvement: ${comparison.display} — needs > ${comparison.requiredPct.toFixed(1)}% over ${ctx.bestScore ? 'current best' : 'baseline'}`,
      );
      return;
    }

    // Accepted.
    const sha = await wt.commit(`paxcli: ${node.hypothesis}\n\nExperiment ${nodeId}`);
    keepBranch = true;
    const grade = measure.stability.ok ? 'validated' : 'measured';
    const pct = improvementPct(measure.score.value, ctx.baseline.value, config.benchmark.direction);
    await update({
      status: 'accepted',
      commitSha: sha,
      grade,
      finishedAt: new Date().toISOString(),
      decisionReason: `Accepted: ${ctx.baseline.metric} improved ${pct.toFixed(1)}% vs baseline (${comparison.display}), all gates passed`,
    });
    onStatus(`Accepted: ${node.hypothesis} — ${comparison.display}`);
  } catch (err) {
    await update({
      status: 'failed',
      finishedAt: new Date().toISOString(),
      decisionReason: `Infrastructure failure: ${(err as Error).message}`,
    });
  } finally {
    const receipt = buildReceipt({
      runId: ctx.store.dir.split(/[\\/]/).at(-1) ?? '',
      node,
      baseSha: ctx.baseSha,
      baseline: ctx.baseline,
      comparison,
      pinsVerified,
      configHash: ctx.cfgHash,
    });
    await writeReceipt(store.receiptsDir(), receipt);
    ctx.onReceipt(receipt);
    await wt.destroy({ keepBranch });
  }

  async function reject(why: string, status: 'rejected' | 'failed' = 'rejected'): Promise<void> {
    await update({
      status,
      finishedAt: new Date().toISOString(),
      decisionReason: status === 'rejected' ? `Rejected: ${why}` : why,
    });
    await store.append({
      type: 'insight_added',
      insight: {
        id: shortId(6),
        kind: 'rejected_hypothesis',
        text: `"${node.hypothesis || '(no hypothesis)'}" → ${why}`,
        nodeId,
        round: ctx.round,
        createdAt: new Date().toISOString(),
      },
    });
    onStatus(`Rejected: ${why}`);
  }
}
