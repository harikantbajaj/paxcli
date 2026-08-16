import pc from 'picocolors';
import type { PaxcliConfig } from '../config/schema.js';
import { FleetClient } from '../control-plane/client.js';
import { type RunOutcome, runOptimize } from '../engine/run-loop.js';
import type { HostAdapter } from '../hosts/types.js';
import { permissionSummary } from '../policy/env.js';
import { renderVerificationCard } from '../report/card.js';
import type { Output } from './output.js';

export type PresetName = 'quick' | 'balanced' | 'deep';

export function applyPreset(config: PaxcliConfig, preset: PresetName): PaxcliConfig {
  const presets: Record<PresetName, Partial<PaxcliConfig['search']> & { maxCostUsd?: number }> = {
    quick: { maxRounds: 1, parallel: 2, maxNodes: 2, maxCostUsd: 2 },
    balanced: { maxRounds: 3, parallel: 2, maxNodes: 8, maxCostUsd: 5 },
    deep: { maxRounds: 6, parallel: 3, maxNodes: 18, maxCostUsd: 20 },
  };
  const p = presets[preset];
  return {
    ...config,
    search: {
      ...config.search,
      maxRounds: p.maxRounds ?? config.search.maxRounds,
      parallel: p.parallel ?? config.search.parallel,
      maxNodes: p.maxNodes ?? config.search.maxNodes,
    },
    budget: { ...config.budget, maxCostUsd: p.maxCostUsd ?? config.budget.maxCostUsd },
  };
}

export interface OptimizeUiOptions {
  repoRoot: string;
  config: PaxcliConfig;
  host: HostAdapter;
  out: Output;
  resumeRunId?: string;
  showPermissions?: boolean;
  extraSteering?: string | null;
}

/** Shared runner: SIGINT-safe optimize with human/JSON reporting. */
export async function runOptimizeWithUi(opts: OptimizeUiOptions): Promise<RunOutcome> {
  const { repoRoot, config, host, out } = opts;
  const fleet = FleetClient.fromEnvironment();

  if (opts.showPermissions !== false) {
    out.info('');
    out.info(pc.bold('Permissions for this run:'));
    out.info(
      permissionSummary(
        config.policy,
        config.gates.map((g) => g.name),
      ),
    );
    out.info('');
  }

  const controller = new AbortController();
  const onSigint = () => {
    out.status('Stopping gracefully — cleaning up worktrees. Resume later with `paxcli resume`.');
    controller.abort();
  };
  process.once('SIGINT', onSigint);

  try {
    await fleet?.begin({
      repoRoot,
      request: opts.extraSteering ?? 'Find a verified performance improvement',
      agent: host.id,
      model: config.host.model ?? null,
    });
    try {
      const outcome = await runOptimize({
        repoRoot,
        config,
        host,
        signal: controller.signal,
        onStatus: (msg) => {
          out.status(msg);
          void fleet?.status(msg);
        },
        ...(opts.resumeRunId ? { resumeRunId: opts.resumeRunId } : {}),
        ...(opts.extraSteering ? { extraSteering: opts.extraSteering } : {}),
      });
      await fleet?.finish(outcome);
      reportOutcome(outcome, out);
      return outcome;
    } catch (error) {
      await fleet?.fail(error);
      throw error;
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

export function reportOutcome(outcome: RunOutcome, out: Output): void {
  out.info('');
  out.info(pc.bold(`Run ${outcome.runId} finished: ${outcome.reason}`));
  out.info(
    `Experiments: ${outcome.nodesTried} · Total agent cost: $${outcome.totalCostUsd.toFixed(2)}`,
  );

  if (outcome.bestNode) {
    const bestReceipt = outcome.receipts.find((r) => r.nodeId === outcome.bestNode?.id);
    if (bestReceipt && !out.json) {
      out.info('');
      out.info(pc.green(pc.bold('✓ Verified improvement')));
      out.info(`Change:   ${bestReceipt.hypothesis}`);
      out.info(`Outcome:  ${bestReceipt.comparison?.display ?? bestReceipt.decisionReason}`);
      out.info(
        `Evidence: ${bestReceipt.grade ?? 'measured'} · ${bestReceipt.gates.filter((gate) => gate.pass).length}/${bestReceipt.gates.length} checks passed${bestReceipt.reproduction ? ` · fresh reproduction ${bestReceipt.reproduction.held ? 'held' : 'failed'}` : ''}`,
      );
      if (bestReceipt.agent) {
        const cost =
          bestReceipt.agent.costUsd == null
            ? 'cost unavailable'
            : `$${bestReceipt.agent.costUsd.toFixed(2)}`;
        out.info(
          `Agent:    ${bestReceipt.agent.hostId}${bestReceipt.agent.model ? ` (${bestReceipt.agent.model})` : ''} · ${cost}`,
        );
      }
      out.info('');
      out.info(pc.dim('Verification details'));
      out.info(renderVerificationCard(bestReceipt));
    }
    out.info('');
    out.info(
      `Next: ${pc.cyan(`paxcli apply ${outcome.bestNode.id}`)} creates a branch you can review and merge. Paxcli never merges for you.`,
    );
  } else {
    out.info('');
    out.info('No experiment produced a verified improvement this run.');
    const rejections = outcome.receipts
      .filter((r) => r.decision !== 'accepted')
      .map((r) => `  - ${r.decisionReason}`);
    if (rejections.length > 0 && !out.json) {
      out.info('Why experiments were rejected:');
      for (const line of rejections) out.info(line);
    }
  }

  out.result({
    runId: outcome.runId,
    reason: outcome.reason,
    best: outcome.bestNode
      ? {
          nodeId: outcome.bestNode.id,
          hypothesis: outcome.bestNode.hypothesis,
          grade: outcome.bestNode.grade,
          score: outcome.bestNode.score,
          decisionReason: outcome.bestNode.decisionReason,
        }
      : null,
    totalCostUsd: outcome.totalCostUsd,
    nodesTried: outcome.nodesTried,
    receipts: outcome.receipts.map((r) => ({
      nodeId: r.nodeId,
      decision: r.decision,
      grade: r.grade,
      decisionReason: r.decisionReason,
    })),
  });
}
