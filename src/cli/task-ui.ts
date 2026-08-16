import pc from 'picocolors';
import { applyTaskResult } from '../apply/patch.js';
import { discoverRepo } from '../discovery/repo.js';
import { type TaskOutcome, cleanupTaskWorktree, runTask } from '../engine/task-loop.js';
import { chooseTaskHost } from '../hosts/detect.js';
import { ensureRepo } from '../snapshot/build.js';
import { gitOutputRaw } from '../worktree/local.js';
import type { Output } from './output.js';

/**
 * The `npx paxcli` task flow: detect host → discover repo → snapshot → agent →
 * checks → confirm → apply. Honest labels only: subjective work is reported as
 * "checks passed", never with the benchmark-backed verification vocabulary.
 */

export function looksLikePerformanceRequest(task: string): boolean {
  return /\b(?:faster|slow(?:er|ness)?|optimi[sz]e|perf(?:ormance)?|laten(?:cy|t)|throughput|speed(?:\s*up)?|memory\s+usage)\b/i.test(
    task,
  );
}

/** Conservative routing for explicit requests to explain or inspect, not edit. */
export function looksLikeInquiryRequest(task: string): boolean {
  const value = task.trim();
  return (
    /^(?:can|could|would|will|do|does|did|is|are|was|were|what|why|when|where|who|which|how)\b/i.test(
      value,
    ) ||
    /^(?:please\s+)?(?:tell me|explain|describe|summar(?:ize|ise)|walk me through|show me how)\b/i.test(
      value,
    )
  );
}

export interface TaskFlowOptions {
  cwd: string;
  request: string;
  out: Output;
  hostId?: string;
  mockPatchesFile?: string;
  model?: string;
  budgetUsd?: number;
  /** Apply without asking. Non-interactive sessions imply this. */
  yes?: boolean;
  /** Skip dependency install in the worktree (tests). */
  installDeps?: boolean;
}

export async function runTaskFlow(opts: TaskFlowOptions): Promise<void> {
  const { out } = opts;
  const intent = looksLikeInquiryRequest(opts.request) ? 'inquiry' : 'change';

  const { root, created } = await ensureRepo(opts.cwd);
  if (created) {
    out.info(
      'No git repository here — initialized one (paxcli needs git for snapshots and isolation).',
    );
  } else if (root !== opts.cwd) {
    out.info(`Operating on the repository root: ${root}`);
  }

  const host = await chooseTaskHost(opts.hostId, opts.mockPatchesFile);
  out.info(`Using ${pc.bold(host.label)}${host.version ? ` ${host.version}` : ''}`);

  const discovery = await discoverRepo(root);
  const checkCmds = (['typecheck', 'lint', 'test', 'build'] as const)
    .filter((k) => discovery.commands[k])
    .map((k) => discovery.commands[k]?.cmd);
  out.info(
    `Repository: ${discovery.language ?? 'unknown'}${discovery.packageManager ? ` (${discovery.packageManager})` : ''} · checks: ${
      checkCmds.length > 0 ? checkCmds.join(' · ') : pc.yellow('none found')
    }`,
  );
  for (const note of discovery.notes) out.info(`  ${pc.yellow('!')} ${note}`);
  out.info('');

  const controller = new AbortController();
  const onSigint = () => {
    out.status('Stopping gracefully — your repository is untouched.');
    controller.abort();
  };
  process.once('SIGINT', onSigint);

  let outcome: TaskOutcome;
  try {
    outcome = await runTask({
      repoRoot: root,
      task: opts.request,
      host: host.adapter,
      discovery,
      signal: controller.signal,
      onStatus: (m) => out.status(m),
      ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.installDeps !== undefined ? { installDeps: opts.installDeps } : {}),
      intent,
    });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  if (outcome.status !== 'succeeded') {
    reportFailure(outcome, out);
    process.exitCode = 1;
    return;
  }

  if (outcome.intent === 'inquiry') {
    out.info('');
    out.info(outcome.agentFinalText.trim());
    out.result({
      runId: outcome.runId,
      status: outcome.status,
      intent: outcome.intent,
      answer: outcome.agentFinalText.trim(),
      attempts: outcome.attempts,
      totalCostUsd: outcome.totalCostUsd,
      applied: false,
    });
    return;
  }

  // ---- Success: show what happened, then confirm and apply -----------------
  out.info('');
  out.info(pc.bold(`Implementation completed — ${outcome.summary}`));
  out.info('');
  out.info('Changed:');
  for (const f of outcome.changedFiles) out.info(`  ${f}`);
  out.info('');
  out.info('Checks:');
  if (outcome.checks.length === 0) {
    out.info(
      `  ${pc.yellow('!')} none ran — no validation commands were found, so this change was NOT tested by paxcli`,
    );
  } else {
    for (const c of outcome.checks) {
      out.info(`  ${c.pass ? pc.green('✓') : pc.red('✗')} ${c.name} (${c.cmd})`);
    }
  }
  out.info(`  ${pc.green('✓')} protected files unchanged (existing tests, CI, config)`);
  for (const s of outcome.suspicions) out.info(`  ${pc.yellow('!')} review: ${s}`);
  if (outcome.totalCostUsd > 0) out.info(`  Agent cost: $${outcome.totalCostUsd.toFixed(2)}`);

  if (outcome.snapshotSha && outcome.resultSha) {
    const stat = await gitOutputRaw(root, [
      'diff',
      '--stat',
      outcome.snapshotSha,
      outcome.resultSha,
    ]).catch(() => '');
    if (stat.trim()) {
      out.info('');
      const lines = stat.trimEnd().split('\n');
      for (const line of lines.slice(0, 25)) out.info(pc.dim(line));
      if (lines.length > 25) out.info(pc.dim(`  … ${lines.length - 25} more lines`));
    }
  }

  const interactive = !opts.yes && !out.json && process.stdin.isTTY && process.stdout.isTTY;
  let apply = true;
  if (interactive) {
    const { confirm, isCancel } = await import('@clack/prompts');
    const answer = await confirm({ message: 'Apply these changes to your working directory?' });
    apply = !isCancel(answer) && answer === true;
  }

  let applied = false;
  let conflicts: string[] = [];
  if (apply && outcome.snapshotSha && outcome.resultSha && outcome.patchPath) {
    const result = await applyTaskResult({
      repoRoot: root,
      runId: outcome.runId,
      snapshotSha: outcome.snapshotSha,
      resultSha: outcome.resultSha,
      patchPath: outcome.patchPath,
    });
    applied = result.applied;
    conflicts = result.conflicts;
    out.info('');
    if (result.applied) {
      await cleanupTaskWorktree(root, outcome).catch(() => {});
      out.info(
        pc.green(
          'The changes are now in your working directory (unstaged — review and commit when ready).',
        ),
      );
      out.info(`Recovery patch: ${outcome.patchPath}`);
    } else if (result.conflicts.length > 0) {
      out.info(
        pc.red(
          'Not applied: you edited the same lines while paxcli was working. Your files were not touched.',
        ),
      );
      out.info('Conflicting files:');
      for (const f of result.conflicts) out.info(`  ${f}`);
      out.info(`The accepted result is kept at: ${outcome.worktreePath}`);
      out.info(`Patch: ${outcome.patchPath} · clean up later with \`paxcli gc\``);
      process.exitCode = 1;
    } else {
      out.info(pc.red(`Not applied: ${result.problem ?? 'unknown reason'}`));
      out.info(`The accepted result is kept at: ${outcome.worktreePath}`);
      out.info(`Patch: ${outcome.patchPath}`);
      process.exitCode = 1;
    }
  } else if (!apply) {
    out.info('');
    out.info('Not applied. The result is kept for you to inspect:');
    out.info(`  Worktree: ${outcome.worktreePath}`);
    out.info(`  Patch:    ${outcome.patchPath} (apply later with \`git apply\`)`);
    out.info('Clean up with `paxcli gc` when done.');
  }

  out.result({
    runId: outcome.runId,
    status: outcome.status,
    intent: outcome.intent,
    summary: outcome.summary,
    changedFiles: outcome.changedFiles,
    checks: outcome.checks.map((c) => ({ name: c.name, cmd: c.cmd, pass: c.pass })),
    checksSkipped: outcome.checksSkipped,
    suspicions: outcome.suspicions,
    attempts: outcome.attempts,
    totalCostUsd: outcome.totalCostUsd,
    applied,
    conflicts,
    patchPath: outcome.patchPath,
    worktreePath: outcome.worktreePath,
  });
}

function reportFailure(outcome: TaskOutcome, out: Output): void {
  out.info('');
  out.info(pc.red(pc.bold(`Task ${outcome.status}`)));
  out.info(outcome.reason);
  const failedCheck = outcome.checks.find((c) => !c.pass);
  if (failedCheck?.outputTail) {
    out.info('');
    out.info(pc.dim(`--- ${failedCheck.name} output (tail) ---`));
    out.info(pc.dim(failedCheck.outputTail.slice(-1200)));
  }
  if (outcome.worktreePath) {
    out.info('');
    out.info(`The last attempt is kept for inspection: ${outcome.worktreePath}`);
    if (outcome.patchPath) out.info(`Its diff: ${outcome.patchPath}`);
    out.info('Clean up with `paxcli gc`.');
  }
  out.result({
    runId: outcome.runId,
    status: outcome.status,
    reason: outcome.reason,
    summary: outcome.summary,
    changedFiles: outcome.changedFiles,
    checks: outcome.checks.map((c) => ({ name: c.name, cmd: c.cmd, pass: c.pass })),
    attempts: outcome.attempts,
    totalCostUsd: outcome.totalCostUsd,
    applied: false,
    patchPath: outcome.patchPath,
    worktreePath: outcome.worktreePath,
  });
}
