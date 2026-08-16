import type { Command } from 'commander';
import pc from 'picocolors';
import { BenchmarkHarness } from '../../bench/harness.js';
import { loadConfig } from '../../config/schema.js';
import { NotFoundError } from '../../util/errors.js';
import { guard, withMeasurementWorktree } from '../helpers.js';
import { Output } from '../output.js';

/** `paxcli ci …` — regression prevention for CI pipelines. */
export function registerCiCommands(program: Command): void {
  const ci = program.command('ci').description('Regression prevention for CI pipelines');

  ci.command('baseline')
    .description('Measure HEAD and store it as the performance baseline snapshot')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const config = await loadConfig(repoRoot);
        const { score, file } = await withMeasurementWorktree(repoRoot, 'cib', async (wt) => {
          const harness = new BenchmarkHarness(config.benchmark, {
            cwd: wt.path,
            onStatus: (m) => out.status(m),
          });
          const result = await harness.measure('ci baseline');
          const { writeBaseline } = await import('../../ci/baseline.js');
          const written = await writeBaseline(repoRoot, result.score, wt.headSha);
          return { score: result.score, file: written };
        });
        out.info(
          `${pc.green('✓')} Baseline stored: ${score.metric} = ${score.value.toFixed(2)} → ${file}`,
        );
        out.info('Commit .paxcli/baseline.json so CI can verify against it.');
        out.result({ baseline: score, file });
      });
    });

  ci.command('verify')
    .description('Fail (exit 1) when HEAD regresses beyond tolerance vs the stored baseline')
    .option('--tolerance <pct>', 'allowed regression percent beyond noise', '2')
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { tolerance: string; json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const config = await loadConfig(repoRoot);
        const { readBaseline, judgeRegression } = await import('../../ci/baseline.js');
        const stored = await readBaseline(repoRoot);
        if (!stored) {
          throw new NotFoundError(
            'No baseline snapshot found.',
            'Create one with `paxcli ci baseline` and commit .paxcli/baseline.json.',
          );
        }
        const verdict = await withMeasurementWorktree(repoRoot, 'civ', async (wt) => {
          const harness = new BenchmarkHarness(config.benchmark, {
            cwd: wt.path,
            onStatus: (m) => out.status(m),
          });
          const result = await harness.measure('ci verify');
          return judgeRegression(stored, result.score, config, Number(opts.tolerance));
        });
        out.info(verdict.ok ? pc.green(`✓ ${verdict.message}`) : pc.red(`✗ ${verdict.message}`));
        out.result({ ok: verdict.ok, message: verdict.message, comparison: verdict.comparison });
        if (!verdict.ok) process.exitCode = 1;
      });
    });
}
