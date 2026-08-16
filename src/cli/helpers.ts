import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { loadConfig } from '../config/schema.js';
import { EventStore } from '../tree/store.js';
import type { ExperimentNode, RunSummary } from '../tree/types.js';
import { NotFoundError } from '../util/errors.js';
import { shortId } from '../util/ids.js';
import { WorktreeBackend, snapshotRepo } from '../worktree/local.js';
import type { Output } from './output.js';

/** Uniform command wrapper: human error + hint on stderr, JSON failure doc on stdout. */
export async function guard(out: Output, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    process.exitCode = out.failure(err);
  }
}

export interface WinnerRef {
  runId: string;
  nodeId: string;
  commitSha: string;
  node: ExperimentNode;
  store: EventStore;
  summary: RunSummary;
}

/** Shared by `apply` and `pr`: latest (or named) run → accepted node, or throw. */
export async function resolveAcceptedNode(
  repoRoot: string,
  nodeIdArg: string | undefined,
  runOpt: string | undefined,
): Promise<WinnerRef> {
  const runs = await EventStore.listRuns(repoRoot);
  const runIdValue = runOpt ?? runs.at(-1);
  if (!runIdValue) {
    throw new NotFoundError(
      'No runs found in this repository.',
      'Start one with `paxcli start` (or `paxcli demo` to see the flow first).',
    );
  }
  const store = await EventStore.open(repoRoot, runIdValue);
  const summary = await store.replay();
  const chosenId = nodeIdArg ?? summary.bestNodeId;
  if (!chosenId) {
    throw new NotFoundError(
      `Run ${runIdValue} has no accepted experiment.`,
      'List runs with `paxcli run list`, then pass one: `paxcli apply --run <runId>`.',
    );
  }
  const node = summary.nodes.get(chosenId);
  if (!node || node.status !== 'accepted' || !node.commitSha) {
    throw new NotFoundError(
      `Experiment ${chosenId} is not an accepted result.`,
      'See accepted experiments with `paxcli status` or `paxcli run list`.',
    );
  }
  return { runId: runIdValue, nodeId: chosenId, commitSha: node.commitSha, node, store, summary };
}

/** Latest run id, or a clear error. Shared "resolve run → open store" preamble. */
export async function resolveRun(
  repoRoot: string,
  runOpt: string | undefined,
): Promise<{ runId: string; store: EventStore }> {
  const runs = await EventStore.listRuns(repoRoot);
  const runIdValue = runOpt ?? runs.at(-1);
  if (!runIdValue) throw new NotFoundError('No runs found.', 'Start one with `paxcli start`.');
  return { runId: runIdValue, store: await EventStore.open(repoRoot, runIdValue) };
}

/**
 * One-shot measurement in a throwaway worktree at HEAD — shared by
 * `benchmark validate`, `ci baseline`, and `ci verify`. Always destroyed.
 */
export async function withMeasurementWorktree<T>(
  repoRoot: string,
  prefix: string,
  fn: (wt: { path: string; headSha: string }) => Promise<T>,
): Promise<T> {
  const snapshot = await snapshotRepo(repoRoot);
  const backend = new WorktreeBackend(repoRoot);
  const wt = await backend.provision(`${prefix}-${shortId(5)}`, snapshot.headSha);
  try {
    return await fn({ path: wt.path, headSha: snapshot.headSha });
  } finally {
    await wt.destroy({ keepBranch: false });
  }
}

export async function resolveLedgerPath(repoRoot: string, override?: string): Promise<string> {
  if (override) return override;
  try {
    return (await loadConfig(repoRoot)).ledger.path;
  } catch {
    const { LEDGER_DEFAULT_PATH } = await import('../ledger/file.js');
    return LEDGER_DEFAULT_PATH;
  }
}

/** Best-effort: the ledger is evidence, not a gate — never fails the command. */
export async function recordOptimizationInLedger(
  repoRoot: string,
  store: EventStore,
  nodeId: string,
  out: Output,
): Promise<{ file: string; added: boolean } | null> {
  try {
    let enabled = true;
    let ledgerPath: string | undefined;
    try {
      const cfg = await loadConfig(repoRoot);
      enabled = cfg.ledger.enabled;
      ledgerPath = cfg.ledger.path;
    } catch {
      // No (or invalid) config — Simple-Mode-style defaults apply.
    }
    if (!enabled) return null;
    const receiptPath = path.join(store.receiptsDir(), `${nodeId}.redacted.json`);
    if (!existsSync(receiptPath)) return null;
    const { parseReceipt } = await import('../proof/receipt.js');
    const receipt = parseReceipt(JSON.parse(await readFile(receiptPath, 'utf8')), receiptPath);
    const { entryFromReceipt } = await import('../ledger/schema.js');
    const { appendLedgerEntry } = await import('../ledger/file.js');
    const res = await appendLedgerEntry({
      repoRoot,
      entry: entryFromReceipt(receipt),
      ...(ledgerPath ? { ledgerPath } : {}),
    });
    out.info(
      res.added
        ? `  ${pc.green('✓')} Recorded in ${path.basename(res.file)} (unstaged — commit it with the change)`
        : `  Already recorded in ${path.basename(res.file)}.`,
    );
    return { file: res.file, added: res.added };
  } catch (err) {
    out.info(pc.yellow(`  ! Proof Ledger not updated: ${(err as Error).message}`));
    return null;
  }
}
