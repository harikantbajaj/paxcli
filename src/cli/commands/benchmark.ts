import type { Command } from 'commander';
import pc from 'picocolors';
import { BenchmarkHarness } from '../../bench/harness.js';
import { loadConfig } from '../../config/schema.js';
import { guard, withMeasurementWorktree } from '../helpers.js';
import { Output } from '../output.js';

/** `paxcli benchmark …` — benchmark reliability tools. */
export function registerBenchmarkCommands(program: Command): void {
  const bench = program.command('benchmark').description('Benchmark reliability tools');

  bench
    .command('validate')
    .description('Measure the benchmark on current HEAD and judge its reliability')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const config = await loadConfig(repoRoot);
        const result = await withMeasurementWorktree(repoRoot, 'val', async (wt) => {
          const harness = new BenchmarkHarness(config.benchmark, {
            cwd: wt.path,
            onStatus: (m) => out.status(m),
          });
          return harness.measure('validation');
        });
        out.info('');
        out.info(
          `${config.benchmark.metric}: median ${result.score.value.toFixed(2)} over ${result.score.samples.length} samples`,
        );
        out.info(`Noise (CV): ${result.stability.cvPct.toFixed(1)}%`);
        if (result.stability.ok) {
          out.info(pc.green('✓ Reliable enough to optimize against.'));
        } else {
          out.info(pc.red('✗ Not reliable enough:'));
          for (const p of result.stability.problems) out.info(`  - ${p}`);
          process.exitCode = 1;
        }
        out.result({ score: result.score, stability: result.stability });
      });
    });

  bench
    .command('discover')
    .description(
      'Scan the codebase for ranked optimization opportunities (heuristics — the benchmark decides)',
    )
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        let writable = ['src/**'];
        try {
          writable = (await loadConfig(repoRoot)).policy.writable;
        } catch {
          // no config yet — scan the default src glob
        }
        const { discover } = await import('../../discovery/scan.js');
        const findings = await discover(repoRoot, writable);
        out.info(
          pc.dim(`Scanned files matching: ${writable.join(', ')} (your config's policy.writable)`),
        );
        if (findings.length === 0) {
          out.info(
            'No common performance smells found in that scope. Widen policy.writable to scan more — and remember: static heuristics only suggest, the benchmark tells the real story.',
          );
        } else {
          out.info(pc.bold(`Found ${findings.length} candidate(s), strongest signal first:\n`));
          for (const f of findings.slice(0, 12)) {
            out.info(
              `${pc.cyan(`${f.file}:${f.line}`)} [${f.category}] confidence ${f.confidence}/5`,
            );
            out.info(`  ${pc.dim(f.snippet)}`);
            out.info(`  ${f.why}\n`);
          }
        }
        out.result({ findings });
      });
    });
}
