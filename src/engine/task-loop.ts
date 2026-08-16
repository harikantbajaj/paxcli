import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { type GateConfig, gateSchema, policySchema } from '../config/schema.js';
import type { DetectedCommand, RepoDiscovery } from '../discovery/repo.js';
import { runGates } from '../gates/engine.js';
import { ensureHostAvailable } from '../hosts/detect.js';
import type { HostAdapter } from '../hosts/types.js';
import { buildAgentEnv } from '../policy/env.js';
import { capturePins } from '../proof/pins.js';
import { screenCandidate } from '../proof/verify.js';
import { type Snapshot, buildSnapshot, writeResultRef } from '../snapshot/build.js';
import { EngineLock, EventStore, appendTerminalEvent } from '../tree/store.js';
import { type GateResult, agentRunSummary, newExperimentNode } from '../tree/types.js';
import { runId as newRunId, shortId } from '../util/ids.js';
import { Worktree, WorktreeBackend } from '../worktree/local.js';
import {
  buildInquiryPrompt,
  buildRepairPrompt,
  buildTaskPrompt,
  extractSummary,
} from './task-prompt.js';

/**
 * General task mode: one agent, one isolated worktree branched from an
 * internal snapshot of the user's working tree, engine-side verification
 * (pins → detectors → discovered validation commands), and a bounded repair
 * loop. No benchmark, no parallel experiments, and deliberately none of the
 * Measured/Validated/Equivalent/Reproduced grades — "checks passed" is the
 * strongest claim subjective work can honestly earn.
 */

export const TASK_MARKER_FILENAME = 'task.json';

// Staging with dependency-directory exclusion lives on Worktree
// (stageAllExcludingDeps in ../worktree/local.js) — shared with the optimize
// engine so install artifacts never masquerade as agent changes in either flow.

export interface TaskRunOptions {
  repoRoot: string;
  task: string;
  host: HostAdapter;
  discovery: RepoDiscovery;
  signal: AbortSignal;
  onStatus: (msg: string) => void;
  /** Stop before a repair attempt once agent spend reaches this. Default $5. */
  budgetUsd?: number;
  /** Per agent attempt. Default 15 minutes. */
  agentTimeoutMs?: number;
  /** Repair attempts after the first implementation attempt. Default 2. */
  maxRepairs?: number;
  model?: string;
  /** Set false to skip dependency installation in the worktree (tests). */
  installDeps?: boolean;
  /** Questions are answered read-only and do not require a diff or validation. */
  intent?: 'change' | 'inquiry';
}

export interface TaskCheckResult {
  name: string;
  cmd: string;
  pass: boolean;
  outputTail: string;
}

export type TaskStatus = 'succeeded' | 'failed' | 'rejected' | 'interrupted' | 'error';

export interface TaskOutcome {
  runId: string;
  status: TaskStatus;
  /** Plain-English explanation of the status. */
  reason: string;
  /** Agent's one-line description of the change. */
  summary: string;
  changedFiles: string[];
  checks: TaskCheckResult[];
  /** True when the repository had no discoverable validation commands. */
  checksSkipped: boolean;
  /** Suspicion-level detector findings for the human to review. */
  suspicions: string[];
  attempts: number;
  totalCostUsd: number;
  snapshotSha: string | null;
  resultSha: string | null;
  patchPath: string | null;
  /** Non-null when the worktree was kept for inspection or later application. */
  worktreePath: string | null;
  worktreeBranch: string | null;
  agentFinalText: string;
  intent: 'change' | 'inquiry';
}

export async function runTask(opts: TaskRunOptions): Promise<TaskOutcome> {
  const { repoRoot, task, host, discovery, signal, onStatus } = opts;
  const budgetUsd = opts.budgetUsd ?? 5;
  const agentTimeoutMs = opts.agentTimeoutMs ?? 15 * 60 * 1000;
  const maxRepairs = opts.maxRepairs ?? 2;
  const intent = opts.intent ?? 'change';

  const id = newRunId();
  const store = await EventStore.create(repoRoot, id);
  const lock = await EngineLock.acquire(store.dir);
  // Anything that can throw between acquire and the main try/finally must
  // release the lock itself, or the run dir stays locked forever.
  try {
    await writeFile(
      path.join(store.dir, TASK_MARKER_FILENAME),
      JSON.stringify({ task, createdAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
    await writeFile(
      path.join(store.dir, 'discovery.json'),
      JSON.stringify(discovery, null, 2),
      'utf8',
    );
  } catch (err) {
    await lock.release();
    throw err;
  }

  const outcome: TaskOutcome = {
    runId: id,
    status: 'error',
    reason: '',
    summary: '',
    changedFiles: [],
    checks: [],
    checksSkipped: Object.keys(discovery.commands).length === 0,
    suspicions: [],
    attempts: 0,
    totalCostUsd: 0,
    snapshotSha: null,
    resultSha: null,
    patchPath: null,
    worktreePath: null,
    worktreeBranch: null,
    agentFinalText: '',
    intent,
  };

  try {
    await ensureHostAvailable(host);
  } catch (err) {
    await lock.release();
    throw err;
  }

  let wt: Worktree | null = null;
  let keepWorktree = false;
  let snapshot: Snapshot | null = null;

  const node = newExperimentNode({ id: `task-${shortId(4)}`, hypothesis: task.slice(0, 200) });

  const finish = async (status: TaskStatus, reason: string) => {
    outcome.status = status;
    outcome.reason = reason;
    await store.append({
      type: 'node_updated',
      nodeId: node.id,
      patch: {
        status: status === 'succeeded' ? 'accepted' : status === 'rejected' ? 'rejected' : 'failed',
        commitSha: outcome.resultSha,
        decisionReason: reason,
        finishedAt: new Date().toISOString(),
      },
    });
    await appendTerminalEvent(store, {
      aborted: signal.aborted,
      reason,
      bestNodeId: status === 'succeeded' ? node.id : null,
    });
  };

  try {
    onStatus('Snapshotting your working tree (your files, branch, and index are not modified)');
    snapshot = await buildSnapshot(repoRoot, id);
    outcome.snapshotSha = snapshot.sha;
    await store.append({
      type: 'run_started',
      runId: id,
      baseSha: snapshot.sha,
      baseBranch: '(snapshot)',
      configHash: 'task',
      policyHash: 'task',
      startedAt: new Date().toISOString(),
    });

    const backend = new WorktreeBackend(repoRoot);
    wt = await backend.provision(`task-${shortId(4)}`, snapshot.sha);
    node.branch = wt.branch;
    await store.append({ type: 'node_created', node });

    if (intent === 'change' && discovery.installCmd && opts.installDeps !== false) {
      onStatus(`Installing dependencies in the isolated worktree (${discovery.installCmd})`);
      const install = await execa(discovery.installCmd, {
        cwd: wt.path,
        shell: true,
        timeout: 10 * 60 * 1000,
        cancelSignal: signal,
        reject: false,
        all: true,
      });
      if (signal.aborted) {
        await finish('interrupted', 'Interrupted during dependency installation.');
        return outcome;
      }
      if (install.exitCode !== 0) {
        await finish(
          'error',
          `Dependency installation failed in the worktree (${discovery.installCmd}):\n${String(install.all ?? '').slice(-1500)}`,
        );
        return outcome;
      }
    }

    // Pins are captured from the WORKTREE (HEAD there = the snapshot), so
    // the user's uncommitted edits to protected files are pinned too.
    const pins = await capturePins(wt.path, discovery.protectedGlobs);
    const policy = policySchema.parse({});
    const env = buildAgentEnv(policy);
    const traceDir = store.tracesDir(node.id);
    await mkdir(traceDir, { recursive: true });

    const gates: GateConfig[] = (['typecheck', 'lint', 'test', 'build'] as const).flatMap((k) => {
      const found = discovery.commands[k];
      if (!found) return [];
      return [
        gateSchema.parse({
          id: k,
          name: k === 'test' ? 'tests' : k,
          cmd: found.cmd,
          kind: k === 'test' ? 'tests' : 'custom',
        }),
      ];
    });

    const maxAttempts = 1 + maxRepairs;
    let prompt =
      intent === 'inquiry'
        ? buildInquiryPrompt({ question: task, discovery })
        : buildTaskPrompt({ task, discovery, protectedGlobs: discovery.protectedGlobs });

    await store.append({ type: 'node_updated', nodeId: node.id, patch: { status: 'running' } });

    while (outcome.attempts < maxAttempts) {
      if (signal.aborted) {
        await finish(
          'interrupted',
          'Interrupted by the user. Nothing was changed in your repository.',
        );
        return outcome;
      }
      outcome.attempts += 1;
      onStatus(
        outcome.attempts === 1
          ? 'Agent working on your task'
          : `Repair attempt ${outcome.attempts - 1} of ${maxRepairs}`,
      );

      const agentResult = await host.spawnAgent({
        prompt,
        cwd: wt.path,
        timeoutMs: agentTimeoutMs,
        signal,
        env,
        logPath: path.join(traceDir, `agent-${outcome.attempts}.jsonl`),
        onStatus,
        ...(opts.model ? { model: opts.model } : {}),
      });
      outcome.agentFinalText = agentResult.finalText;
      if (agentResult.costUsd) {
        outcome.totalCostUsd += agentResult.costUsd;
        await store.append({
          type: 'cost_recorded',
          nodeId: node.id,
          costUsd: agentResult.costUsd,
        });
      }
      await store.append({
        type: 'node_updated',
        nodeId: node.id,
        patch: { agentRun: agentRunSummary(host.id, opts.model ?? null, agentResult) },
      });

      if (signal.aborted) {
        await finish(
          'interrupted',
          'Interrupted by the user. Nothing was changed in your repository.',
        );
        return outcome;
      }
      if (!agentResult.ok) {
        await finish('failed', `Agent did not complete (${agentResult.exitReason}).`);
        return outcome;
      }
      outcome.summary = extractSummary(agentResult.finalText);

      // Engine-side verification — the shared screening pipeline (pins →
      // change check → detectors). The agent never judges its own work.
      // Dependency changes are allowed in task mode ("add a date picker" may
      // genuinely need one) but always surface as a review flag.
      const screen = await screenCandidate({
        worktree: wt,
        pins,
        allowDependencyChanges: true,
      });

      if (screen.verdict === 'pin-violation') {
        await finish(
          'rejected',
          `The agent modified protected file(s): ${screen.files}. Protected files (existing tests, CI, config) are integrity-pinned; edits to them are auto-rejected.`,
        );
        return outcome;
      }

      if (screen.verdict === 'no-changes') {
        if (intent === 'inquiry') {
          outcome.summary = 'Repository question answered.';
          await finish('succeeded', 'Repository question answered without changing any files.');
          return outcome;
        }
        await finish(
          'failed',
          `The agent made no file changes. Its final message:\n${agentResult.finalText.slice(0, 800)}`,
        );
        return outcome;
      }

      if (intent === 'inquiry') {
        // A question never authorizes edits, whatever the diff contains.
        outcome.changedFiles =
          screen.verdict === 'clean' ? screen.changedFiles : await wt.changedFiles();
        await finish(
          'rejected',
          `This was a repository question, so file changes were not authorized: ${outcome.changedFiles.join(', ')}.`,
        );
        return outcome;
      }

      if (screen.verdict === 'detector-violation') {
        outcome.changedFiles = await wt.changedFiles();
        await finish('rejected', `Detector "${screen.detector}": ${screen.detail}`);
        return outcome;
      }

      outcome.changedFiles = screen.changedFiles;
      outcome.suspicions = screen.suspicions;

      const gateResults: GateResult[] = await runGates(gates, wt.path, env, onStatus);
      outcome.checks = gateResults.map((g) => ({
        name: g.name,
        cmd: gates.find((x) => x.id === g.gateId)?.cmd ?? '',
        pass: g.pass,
        outputTail: g.stdoutTail,
      }));
      await store.append({ type: 'node_updated', nodeId: node.id, patch: { gateResults } });

      const failedGate = gateResults.find((g) => !g.pass);
      if (!failedGate) break; // validation clean — accept

      if (outcome.attempts >= maxAttempts) {
        keepWorktree = true;
        await writeFailurePatch(store.dir, wt, outcome);
        await finish(
          'failed',
          `Check "${failedGate.name}" still fails after ${maxRepairs} repair attempt(s). The attempt is kept for inspection.`,
        );
        return outcome;
      }
      if (outcome.totalCostUsd >= budgetUsd) {
        keepWorktree = true;
        await writeFailurePatch(store.dir, wt, outcome);
        await finish(
          'failed',
          `Budget limit reached ($${outcome.totalCostUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}) before checks passed.`,
        );
        return outcome;
      }
      prompt = buildRepairPrompt({
        task,
        checkName: failedGate.name,
        cmd: outcome.checks.find((c) => !c.pass)?.cmd ?? '',
        outputTail: failedGate.stdoutTail,
        attempt: outcome.attempts, // next attempt = repair #attempts
        maxRepairs,
      });
    }

    // Accepted: commit in the worktree, record recovery references, write the patch.
    outcome.resultSha = await wt.commit(`paxcli task: ${outcome.summary}\n\nRun ${id}`);
    await writeResultRef(repoRoot, id, outcome.resultSha);
    const { stdout: patchText } = await execa(
      'git',
      ['diff', '--binary', snapshot.sha, outcome.resultSha],
      { cwd: repoRoot },
    );
    outcome.patchPath = path.join(store.dir, 'agent.patch');
    await writeFile(outcome.patchPath, `${String(patchText)}\n`, 'utf8');

    keepWorktree = true; // the apply layer decides when this goes away
    outcome.worktreePath = wt.path;
    outcome.worktreeBranch = wt.branch;
    await finish(
      'succeeded',
      outcome.checksSkipped
        ? 'Implementation completed — but no validation commands were found, so the change was NOT tested by paxcli.'
        : 'Implementation completed; all discovered checks passed.',
    );
    return outcome;
  } catch (err) {
    await finish('error', `Infrastructure failure: ${(err as Error).message}`).catch(() => {});
    return outcome;
  } finally {
    if (wt && !keepWorktree) {
      await wt.destroy({ keepBranch: false }).catch(() => {});
    } else if (wt && keepWorktree) {
      outcome.worktreePath = wt.path;
      outcome.worktreeBranch = wt.branch;
    }
    await lock.release();
  }
}

/** Diff of the (uncommitted) last attempt, for inspecting failures. */
async function writeFailurePatch(
  storeDir: string,
  wt: Worktree,
  outcome: TaskOutcome,
): Promise<void> {
  try {
    const diff = await wt.diff();
    if (diff.trim()) {
      const file = path.join(storeDir, 'attempt.patch');
      await writeFile(file, `${diff}\n`, 'utf8');
      outcome.patchPath = file;
    }
  } catch {
    // inspection aid only — never fail the run over it
  }
}

/** Removes a kept task worktree and its branch once the result is safe elsewhere. */
export async function cleanupTaskWorktree(repoRoot: string, outcome: TaskOutcome): Promise<void> {
  if (!outcome.worktreePath || !outcome.worktreeBranch) return;
  const id = path.basename(outcome.worktreePath);
  const wt = new Worktree(id, outcome.worktreePath, outcome.worktreeBranch, repoRoot);
  await wt.destroy({ keepBranch: false });
  outcome.worktreePath = null;
  outcome.worktreeBranch = null;
}
