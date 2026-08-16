import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig } from '../../config/schema.js';
import { renderVerificationCard } from '../../report/card.js';
import { EventStore } from '../../tree/store.js';
import { WorktreeBackend } from '../../worktree/local.js';
import { guard, resolveRun } from '../helpers.js';
import { Output } from '../output.js';

/** `paxcli run …` — inspect past runs and experiments. */
export function registerRunCommands(program: Command): void {
  const run = program.command('run').description('Inspect past runs and experiments');

  run
    .command('list')
    .description('List runs in this repository')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const runs = await EventStore.listRuns(process.cwd());
        const rows: Array<Record<string, unknown>> = [];
        for (const id of runs) {
          const summary = await (await EventStore.open(process.cwd(), id)).replay();
          const accepted = [...summary.nodes.values()].filter(
            (n) => n.status === 'accepted',
          ).length;
          rows.push({
            runId: id,
            finished: summary.finished,
            reason: summary.finishReason,
            experiments: summary.nodes.size,
            accepted,
            costUsd: summary.totalCostUsd,
          });
          out.info(
            `${id} — ${summary.finished ? summary.finishReason : 'unfinished'} · ${summary.nodes.size} experiments · ${accepted} accepted · $${summary.totalCostUsd.toFixed(2)}`,
          );
        }
        if (runs.length === 0) out.info('No runs yet.');
        out.result({ runs: rows });
      });
    });

  run
    .command('explain <nodeId>')
    .description('Show the full receipt and Verification Card for an experiment')
    .option('--run <runId>', 'run the experiment belongs to (default: latest)')
    .option('--json', 'machine-readable output on stdout')
    .action(async (nodeId: string, opts: { run?: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const { runId, store } = await resolveRun(process.cwd(), opts.run);
        const receiptPath = path.join(store.receiptsDir(), `${nodeId}.json`);
        if (!existsSync(receiptPath))
          throw new Error(`No receipt for experiment ${nodeId} in run ${runId}.`);
        const { parseReceipt } = await import('../../proof/receipt.js');
        const receipt = parseReceipt(JSON.parse(await readFile(receiptPath, 'utf8')), receiptPath);
        if (!out.json) {
          console.log(renderVerificationCard(receipt));
          console.log('');
          console.log(pc.bold('Hypothesis:'), receipt.hypothesis);
          console.log(
            pc.bold('Agent:'),
            receipt.agent
              ? `${receipt.agent.hostId} (${receipt.agent.exitReason}, ${receipt.agent.durationMs}ms)`
              : 'n/a',
          );
          console.log(pc.bold('Receipt:'), receiptPath);
        }
        out.result({ receipt });
      });
    });

  run
    .command('reproduce <nodeId>')
    .description(
      'Re-verify an accepted experiment in brand-new worktrees (interleaved with a fresh baseline)',
    )
    .option('--run <runId>', 'run the experiment belongs to (default: latest)')
    .option('--json', 'machine-readable output on stdout')
    .action(async (nodeId: string, opts: { run?: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const { store } = await resolveRun(repoRoot, opts.run);
        const receiptPath = path.join(store.receiptsDir(), `${nodeId}.json`);
        if (!existsSync(receiptPath)) throw new Error(`No receipt for experiment ${nodeId}.`);
        const { parseReceipt } = await import('../../proof/receipt.js');
        const receipt = parseReceipt(JSON.parse(await readFile(receiptPath, 'utf8')), receiptPath);
        if (!receipt.finalCommit)
          throw new Error(`Experiment ${nodeId} has no committed result to reproduce.`);
        const config = await loadConfig(repoRoot);
        const { reproduceWinner } = await import('../../engine/run-loop.js');
        const backend = new WorktreeBackend(repoRoot);
        const { held, comparison } = await reproduceWinner({
          backend,
          config,
          baseSha: receipt.baseCommit,
          winnerSha: receipt.finalCommit,
          onStatus: (m) => out.status(m),
        });
        out.info(
          held
            ? pc.green(`✓ Reproduction held: ${comparison.display}`)
            : pc.red(`✗ Reproduction did NOT hold: ${comparison.display}`),
        );
        out.result({ held, comparison });
        if (!held) process.exitCode = 1;
      });
    });

  run
    .command('report')
    .description('Write a shareable (redacted) markdown report for a run')
    .option('--run <runId>', 'run to report on (default: latest)')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { run?: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const { store } = await resolveRun(process.cwd(), opts.run);
        const summary = await store.replay();
        const { buildRunReport, writeRunReport } = await import('../../report/markdown.js');
        const content = await buildRunReport({ summary, receiptsDir: store.receiptsDir() });
        const file = await writeRunReport(store.dir, content);
        out.info(`${pc.green('✓')} Report written (redacted, safe to share): ${file}`);
        out.result({ file });
      });
    });
}
