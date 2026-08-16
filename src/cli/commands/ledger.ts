import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { NotFoundError } from '../../util/errors.js';
import { guard, resolveLedgerPath } from '../helpers.js';
import { Output } from '../output.js';

/** `paxcli ledger …` — the Proof Ledger recorded in the user's repository. */
export function registerLedgerCommands(program: Command): void {
  const ledgerCmd = program
    .command('ledger')
    .description('The Proof Ledger — verified changes recorded in your repository (PROOF.md)');

  ledgerCmd
    .command('show')
    .description('List the entries recorded in the Proof Ledger')
    .option('--path <file>', 'ledger file (default: config ledger.path, else PROOF.md)')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { path?: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const ledgerPath = await resolveLedgerPath(repoRoot, opts.path);
        const file = path.join(repoRoot, ledgerPath);
        if (!existsSync(file)) {
          out.info(`No Proof Ledger yet at ${ledgerPath}.`);
          out.info('One is written when you `paxcli apply` a winner or apply a task result.');
          out.result({ path: ledgerPath, exists: false, entries: [] });
          return;
        }
        const { parseLedger, computeStats } = await import('../../ledger/file.js');
        const { entryTitle } = await import('../../ledger/render.js');
        const parsed = parseLedger(await readFile(file, 'utf8'));
        for (const problem of parsed.problems) out.info(pc.yellow(`! ${problem}`));
        const stats = computeStats(parsed.entries);
        out.info(pc.bold(`Proof Ledger — ${ledgerPath}`));
        out.info(
          `${stats.entries} entr${stats.entries === 1 ? 'y' : 'ies'} · ${stats.optimizations} verified optimization(s) · ${stats.tasks} task(s)${stats.bestImprovementPct != null ? ` · best −${stats.bestImprovementPct}%` : ''}`,
        );
        out.info('');
        for (const entry of parsed.entries) {
          out.info(`  ${entry.recordedAt.slice(0, 10)}  ${entryTitle(entry)}`);
        }
        out.result({ path: ledgerPath, exists: true, stats, entries: parsed.entries });
      });
    });

  ledgerCmd
    .command('verify')
    .description('Check the ledger against its own embedded receipts (exit 1 on mismatch)')
    .option('--path <file>', 'ledger file (default: config ledger.path, else PROOF.md)')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { path?: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const ledgerPath = await resolveLedgerPath(repoRoot, opts.path);
        const { verifyLedger } = await import('../../ledger/file.js');
        const verdict = await verifyLedger({ repoRoot, ledgerPath });
        for (const e of verdict.errors) out.info(pc.red(`✗ ${e}`));
        for (const w of verdict.warnings) out.info(pc.yellow(`! ${w}`));
        if (verdict.ok) {
          const n = verdict.stats?.entries ?? 0;
          out.info(
            pc.green(
              `✓ ${ledgerPath} is internally consistent (${n} entr${n === 1 ? 'y' : 'ies'}).`,
            ),
          );
        }
        out.result({
          ok: verdict.ok,
          errors: verdict.errors,
          warnings: verdict.warnings,
          stats: verdict.stats,
        });
        if (!verdict.ok) process.exitCode = 1;
      });
    });

  ledgerCmd
    .command('badge')
    .description('Print a README badge (shields.io) built from the ledger stats')
    .option('--path <file>', 'ledger file (default: config ledger.path, else PROOF.md)')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { path?: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const ledgerPath = await resolveLedgerPath(repoRoot, opts.path);
        const file = path.join(repoRoot, ledgerPath);
        if (!existsSync(file)) throw new NotFoundError(`No ledger found at ${ledgerPath}.`);
        const { parseLedger, computeStats } = await import('../../ledger/file.js');
        const stats = computeStats(parseLedger(await readFile(file, 'utf8')).entries);
        // Honest labels: the verified vocabulary is reserved for benchmark-backed
        // optimization entries; task entries are only ever "recorded".
        const message =
          stats.optimizations > 0
            ? `${stats.optimizations} verified optimization${stats.optimizations === 1 ? '' : 's'}${stats.bestImprovementPct != null ? ` · best −${stats.bestImprovementPct}%` : ''}`
            : stats.entries > 0
              ? `${stats.entries} recorded change${stats.entries === 1 ? '' : 's'}`
              : 'no entries yet';
        const color = stats.optimizations > 0 ? '2ea44f' : 'lightgrey';
        const encode = (s: string) => encodeURIComponent(s.replace(/-/g, '--'));
        const url = `https://img.shields.io/badge/${encode('proof ledger')}-${encode(message)}-${color}`;
        const markdown = `[![Proof Ledger](${url})](${ledgerPath})`;
        out.info('Badge URL:');
        out.info(`  ${pc.cyan(url)}`);
        out.info('Markdown for your README:');
        out.info(`  ${markdown}`);
        out.result({ url, markdown, stats });
      });
    });
}
