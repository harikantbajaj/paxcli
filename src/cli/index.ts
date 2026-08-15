#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { BenchmarkHarness } from '../bench/harness.js';
import { CONFIG_FILENAME, loadConfig, parseConfig } from '../config/schema.js';
import { createHostAdapter } from '../hosts/claude-code/adapter.js';
import type { Receipt } from '../proof/receipt.js';
import { renderVerificationCard } from '../report/card.js';
import { EventStore } from '../tree/store.js';
import { improvementPct } from '../tree/types.js';
import { EXP_BRANCH_PREFIX, WorktreeBackend, gitOutput, snapshotRepo } from '../worktree/local.js';
import { runDemo } from './demo.js';
import { type PresetName, applyPreset, runOptimizeWithUi } from './optimize-ui.js';
import { Output } from './output.js';

const program = new Command();

// The version always comes from package.json (shipped one level above dist/),
// so the CLI can never report a stale number again.
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

program
  .name('paxcli')
  .description(
    'Verified autonomous code optimization: coding agents find performance improvements; Paxcli proves each one is real, safe, and reproducible.',
  )
  .version(pkg.version);

// ---------------------------------------------------------------- primary --

program
  .command('demo')
  .description('Watch the full loop on a bundled slow API — no API keys needed (~2 minutes)')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const outcome = await runDemo(out);
      if (!outcome.bestNode) process.exitCode = 1;
    });
  });

program
  .command('start')
  .description('Guided run on this repository: checks, permissions, then optimize')
  .option('--preset <name>', 'quick | balanced | deep', 'quick')
  .option('--host <id>', 'claude-code | codex | mock', 'claude-code')
  .option('--budget <usd>', 'maximum agent spend in USD')
  .option('--parallel <n>', 'parallel experiments per round')
  .option('--mock-patches <file>', 'patch script for the mock host (testing)')
  .option('--json', 'machine-readable output on stdout')
  .option('-y, --yes', 'skip confirmation prompts')
  .action(async (opts: StartOpts) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, () => startCommand(process.cwd(), opts, out));
  });

program
  .command('resume')
  .description('Continue the most recent interrupted run')
  .option('--host <id>', 'claude-code | mock', 'claude-code')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean; host: string }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const repoRoot = process.cwd();
      const runs = await EventStore.listRuns(repoRoot);
      let target: string | null = null;
      for (const id of [...runs].reverse()) {
        const store = await EventStore.open(repoRoot, id);
        const summary = await store.replay();
        if (!summary.finished) {
          target = id;
          break;
        }
      }
      if (!target) {
        out.info('No interrupted run found. Start a new one with `paxcli start`.');
        return;
      }
      out.status(`Resuming run ${target}`);
      const config = await loadConfig(repoRoot);
      const host = await createHostAdapter(opts.host ?? config.host.id);
      await runOptimizeWithUi({ repoRoot, config, host, out, resumeRunId: target });
    });
  });

program
  .command('status')
  .description('Latest run: best result, cost, and where things stand')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const repoRoot = process.cwd();
      const runs = await EventStore.listRuns(repoRoot);
      const latest = runs.at(-1);
      if (!latest) {
        out.info('No runs yet. Try `paxcli demo` or `paxcli start`.');
        out.result({ runs: [] });
        return;
      }
      const store = await EventStore.open(repoRoot, latest);
      const summary = await store.replay();
      const nodes = [...summary.nodes.values()];
      const best = summary.bestNodeId ? summary.nodes.get(summary.bestNodeId) : null;
      out.info(pc.bold(`Run ${latest}`));
      out.info(
        `State: ${summary.finished ? `finished (${summary.finishReason})` : 'in progress or interrupted'}`,
      );
      if (summary.baseline) {
        out.info(`Baseline: ${summary.baseline.metric} = ${summary.baseline.value.toFixed(2)}`);
      }
      out.info(`Experiments: ${nodes.length} · Cost: $${summary.totalCostUsd.toFixed(2)}`);
      for (const n of nodes) {
        const mark =
          n.status === 'accepted'
            ? pc.green('✓')
            : n.status === 'rejected'
              ? pc.red('✗')
              : pc.dim('…');
        out.info(
          `  ${mark} ${n.id} ${n.hypothesis || '(pending)'} — ${n.decisionReason ?? n.status}`,
        );
      }
      if (best?.score && summary.baseline) {
        const pct = improvementPct(best.score.value, summary.baseline.value, best.score.direction);
        out.info(pc.bold(`Best: ${best.id} — ${pct.toFixed(1)}% improvement (${best.grade})`));
      }
      out.result({
        runId: latest,
        finished: summary.finished,
        reason: summary.finishReason,
        bestNodeId: summary.bestNodeId,
        totalCostUsd: summary.totalCostUsd,
        nodes: nodes.map((n) => ({
          id: n.id,
          status: n.status,
          hypothesis: n.hypothesis,
          reason: n.decisionReason,
        })),
      });
    });
  });

program
  .command('apply [nodeId]')
  .description('Create a reviewable branch (paxcli/winner/<run>) from an accepted experiment')
  .option('--run <runId>', 'run to take the experiment from (default: latest)')
  .option('--json', 'machine-readable output on stdout')
  .action(async (nodeId: string | undefined, opts: { run?: string; json?: boolean }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const repoRoot = process.cwd();
      const runs = await EventStore.listRuns(repoRoot);
      const runIdValue = opts.run ?? runs.at(-1);
      if (!runIdValue) throw new Error('No runs found in this repository.');
      const store = await EventStore.open(repoRoot, runIdValue);
      const summary = await store.replay();
      const chosenId = nodeId ?? summary.bestNodeId;
      if (!chosenId) throw new Error(`Run ${runIdValue} has no accepted experiment to apply.`);
      const node = summary.nodes.get(chosenId);
      if (!node || node.status !== 'accepted' || !node.commitSha) {
        throw new Error(`Experiment ${chosenId} is not an accepted result.`);
      }
      const backend = new WorktreeBackend(repoRoot);
      const branch = await backend.createWinnerBranch(runIdValue, node.commitSha);
      out.info(
        `${pc.green('✓')} Created branch ${pc.cyan(branch)} at ${node.commitSha.slice(0, 7)}`,
      );
      out.info(`  Hypothesis: ${node.hypothesis}`);
      out.info(`  ${node.decisionReason}`);
      out.info('');
      out.info('Review and merge it yourself — Paxcli never merges for you:');
      out.info(`  git diff HEAD...${branch}`);
      out.info(`  git merge ${branch}`);
      out.result({ branch, commit: node.commitSha, nodeId: chosenId, runId: runIdValue });
    });
  });

program
  .command('doctor')
  .description('Check this environment and repository, with exact repair steps')
  .option('--host <id>', 'claude-code | mock', 'claude-code')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean; host: string }) => {
    const out = new Output(Boolean(opts.json));
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

    const major = Number(process.versions.node.split('.')[0]);
    add('Node.js >= 20', major >= 20, `found ${process.version}`);

    try {
      const v = await gitOutput(process.cwd(), ['--version']);
      add('git available', true, v);
    } catch {
      add('git available', false, 'install git and ensure it is on PATH');
    }
    try {
      await gitOutput(process.cwd(), ['rev-parse', 'HEAD']);
      add('git repository with at least one commit', true, 'ok');
    } catch {
      add(
        'git repository with at least one commit',
        false,
        'run: git init && git add -A && git commit -m "baseline"',
      );
    }
    const configPath = path.join(process.cwd(), CONFIG_FILENAME);
    if (existsSync(configPath)) {
      try {
        await loadConfig(process.cwd());
        add(`${CONFIG_FILENAME} valid`, true, 'ok');
      } catch (err) {
        add(`${CONFIG_FILENAME} valid`, false, (err as Error).message);
      }
    } else {
      add(CONFIG_FILENAME, false, 'not found — `paxcli start` will create a template');
    }
    const host = await createHostAdapter(opts.host);
    const detection = await host.detect();
    add(
      `host: ${opts.host}`,
      detection.found,
      detection.found ? (detection.version ?? 'ok') : (detection.problem ?? 'not found'),
    );

    for (const c of checks) {
      out.info(`${c.ok ? pc.green('✓') : pc.red('✗')} ${c.name} — ${c.detail}`);
    }
    out.result({ checks });
    if (checks.some((c) => !c.ok)) process.exitCode = 1;
  });

program
  .command('gc')
  .description('Remove leftover worktrees; --branches also deletes experiment branches')
  .option('--branches', 'delete all paxcli/exp/* branches (winner branches are kept)')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { branches?: boolean; json?: boolean }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const backend = new WorktreeBackend(process.cwd());
      const removed = await backend.sweep();
      out.info(`Removed ${removed.length} leftover worktree(s).`);
      let deletedBranches: string[] = [];
      if (opts.branches) {
        deletedBranches = await backend.listExperimentBranches();
        await backend.deleteBranches(deletedBranches);
        out.info(
          `Deleted ${deletedBranches.length} ${EXP_BRANCH_PREFIX}* branch(es). Winner branches were kept.`,
        );
      }
      out.result({ removedWorktrees: removed, deletedBranches });
    });
  });

// ------------------------------------------------------------------- run ---

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
        const accepted = [...summary.nodes.values()].filter((n) => n.status === 'accepted').length;
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
      const runs = await EventStore.listRuns(process.cwd());
      const runIdValue = opts.run ?? runs.at(-1);
      if (!runIdValue) throw new Error('No runs found.');
      const store = await EventStore.open(process.cwd(), runIdValue);
      const receiptPath = path.join(store.receiptsDir(), `${nodeId}.json`);
      if (!existsSync(receiptPath))
        throw new Error(`No receipt for experiment ${nodeId} in run ${runIdValue}.`);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Receipt;
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
      const runs = await EventStore.listRuns(repoRoot);
      const runIdValue = opts.run ?? runs.at(-1);
      if (!runIdValue) throw new Error('No runs found.');
      const store = await EventStore.open(repoRoot, runIdValue);
      const receiptPath = path.join(store.receiptsDir(), `${nodeId}.json`);
      if (!existsSync(receiptPath)) throw new Error(`No receipt for experiment ${nodeId}.`);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Receipt;
      if (!receipt.finalCommit)
        throw new Error(`Experiment ${nodeId} has no committed result to reproduce.`);
      const config = await loadConfig(repoRoot);
      const { reproduceWinner } = await import('../engine/run-loop.js');
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
      const repoRoot = process.cwd();
      const runs = await EventStore.listRuns(repoRoot);
      const runIdValue = opts.run ?? runs.at(-1);
      if (!runIdValue) throw new Error('No runs found.');
      const store = await EventStore.open(repoRoot, runIdValue);
      const summary = await store.replay();
      const { buildRunReport, writeRunReport } = await import('../report/markdown.js');
      const content = await buildRunReport({ summary, receiptsDir: store.receiptsDir() });
      const file = await writeRunReport(store.dir, content);
      out.info(`${pc.green('✓')} Report written (redacted, safe to share): ${file}`);
      out.result({ file });
    });
  });

// -------------------------------------------------------------- benchmark --

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
      const snapshot = await snapshotRepo(repoRoot);
      const backend = new WorktreeBackend(repoRoot);
      const wt = await backend.provision(`val-${Date.now() % 100000}`, snapshot.headSha);
      try {
        const harness = new BenchmarkHarness(config.benchmark, {
          cwd: wt.path,
          onStatus: (m) => out.status(m),
        });
        const result = await harness.measure('validation');
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
      } finally {
        await wt.destroy({ keepBranch: false });
      }
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
      const { discover } = await import('../discovery/scan.js');
      const findings = await discover(repoRoot, writable);
      if (findings.length === 0) {
        out.info(
          'No common performance smells found by static scanning. A benchmark tells the real story.',
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

// ----------------------------------------------------------------- config --

// ------------------------------------------------------------- steering ----

program
  .command('steer <message...>')
  .description('Send an instruction to the active run (read at the next round boundary)')
  .action(async (message: string[]) => {
    const out = new Output(false);
    await guard(out, async () => {
      const { appendSteering } = await import('../engine/steering.js');
      const file = await appendSteering(process.cwd(), message.join(' '));
      out.info(
        `${pc.green('✓')} Steering recorded in ${file} — agents see it from the next round.`,
      );
    });
  });

// ------------------------------------------------------------ dashboard ----

program
  .command('dashboard')
  .description('Open a read-only live view of a run (127.0.0.1, token-protected)')
  .option('--run <runId>', 'run to view (default: latest)')
  .option('--port <port>', 'port (default: random free port)')
  .action(async (opts: { run?: string; port?: string }) => {
    const out = new Output(false);
    await guard(out, async () => {
      const runs = await EventStore.listRuns(process.cwd());
      const runIdValue = opts.run ?? runs.at(-1);
      if (!runIdValue) throw new Error('No runs to display. Start one with `paxcli start`.');
      const { startDashboard } = await import('../dashboard/server.js');
      const handle = await startDashboard(
        process.cwd(),
        runIdValue,
        opts.port ? Number(opts.port) : 0,
      );
      out.info(`Dashboard for run ${runIdValue}:`);
      out.info(`  ${pc.cyan(handle.url)}`);
      out.info(
        pc.dim('Read-only. Auto-shuts down after 30 minutes without a viewer. Ctrl-C to stop now.'),
      );
      await new Promise(() => {}); // keep serving until Ctrl-C
    });
  });

// -------------------------------------------------------------------- pr ---

program
  .command('pr [nodeId]')
  .description('Open a GitHub PR for an accepted experiment, with the evidence attached')
  .option('--run <runId>', 'run to take the experiment from (default: latest)')
  .action(async (nodeId: string | undefined, opts: { run?: string }) => {
    const out = new Output(false);
    await guard(out, async () => {
      const repoRoot = process.cwd();
      const runs = await EventStore.listRuns(repoRoot);
      const runIdValue = opts.run ?? runs.at(-1);
      if (!runIdValue) throw new Error('No runs found.');
      const store = await EventStore.open(repoRoot, runIdValue);
      const summary = await store.replay();
      const chosenId = nodeId ?? summary.bestNodeId;
      const node = chosenId ? summary.nodes.get(chosenId) : null;
      if (!node || node.status !== 'accepted' || !node.commitSha) {
        throw new Error('No accepted experiment to open a PR for.');
      }
      const backend = new WorktreeBackend(repoRoot);
      const branch = await backend.createWinnerBranch(runIdValue, node.commitSha);

      const { buildRunReport } = await import('../report/markdown.js');
      const body = await buildRunReport({ summary, receiptsDir: store.receiptsDir() });

      out.status(`Pushing ${branch} and opening a PR (nothing is merged without your review)`);
      await execa('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
      const title = `perf: ${node.hypothesis.slice(0, 70)}`;
      const { stdout } = await execa(
        'gh',
        ['pr', 'create', '--head', branch, '--title', title, '--body', body],
        { cwd: repoRoot },
      );
      out.info(`${pc.green('✓')} PR opened: ${String(stdout).trim()}`);
    });
  });

// -------------------------------------------------------------------- ci ---

const ci = program.command('ci').description('Regression prevention for CI pipelines');

ci.command('baseline')
  .description('Measure HEAD and store it as the performance baseline snapshot')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const repoRoot = process.cwd();
      const config = await loadConfig(repoRoot);
      const snapshot = await snapshotRepo(repoRoot);
      const backend = new WorktreeBackend(repoRoot);
      const wt = await backend.provision(`cib-${Date.now() % 100000}`, snapshot.headSha);
      try {
        const harness = new BenchmarkHarness(config.benchmark, {
          cwd: wt.path,
          onStatus: (m) => out.status(m),
        });
        const result = await harness.measure('ci baseline');
        const { writeBaseline } = await import('../ci/baseline.js');
        const file = await writeBaseline(repoRoot, result.score, snapshot.headSha);
        out.info(
          `${pc.green('✓')} Baseline stored: ${result.score.metric} = ${result.score.value.toFixed(2)} → ${file}`,
        );
        out.info('Commit .paxcli/baseline.json so CI can verify against it.');
        out.result({ baseline: result.score, file });
      } finally {
        await wt.destroy({ keepBranch: false });
      }
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
      const { readBaseline, judgeRegression } = await import('../ci/baseline.js');
      const stored = await readBaseline(repoRoot);
      if (!stored) {
        throw new Error(
          'No baseline snapshot found. Create one with `paxcli ci baseline` and commit .paxcli/baseline.json.',
        );
      }
      const snapshot = await snapshotRepo(repoRoot);
      const backend = new WorktreeBackend(repoRoot);
      const wt = await backend.provision(`civ-${Date.now() % 100000}`, snapshot.headSha);
      try {
        const harness = new BenchmarkHarness(config.benchmark, {
          cwd: wt.path,
          onStatus: (m) => out.status(m),
        });
        const result = await harness.measure('ci verify');
        const verdict = judgeRegression(stored, result.score, config, Number(opts.tolerance));
        out.info(verdict.ok ? pc.green(`✓ ${verdict.message}`) : pc.red(`✗ ${verdict.message}`));
        out.result({ ok: verdict.ok, message: verdict.message, comparison: verdict.comparison });
        if (!verdict.ok) process.exitCode = 1;
      } finally {
        await wt.destroy({ keepBranch: false });
      }
    });
  });

const configCmd = program.command('config').description('Configuration tools');

configCmd
  .command('validate')
  .description(`Validate ${CONFIG_FILENAME}`)
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      await loadConfig(process.cwd());
      out.info(pc.green(`✓ ${CONFIG_FILENAME} is valid`));
      out.result({ valid: true });
    });
  });

// ------------------------------------------------------------------ start --

interface StartOpts {
  preset: string;
  host: string;
  budget?: string;
  parallel?: string;
  mockPatches?: string;
  json?: boolean;
  yes?: boolean;
}

async function startCommand(repoRoot: string, opts: StartOpts, out: Output): Promise<void> {
  try {
    await gitOutput(repoRoot, ['rev-parse', 'HEAD']);
  } catch {
    throw new Error(
      'This directory is not a git repository with a commit. Run `git init && git add -A && git commit -m baseline` first.',
    );
  }

  const configPath = path.join(repoRoot, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    await writeConfigTemplate(configPath);
    out.info(
      `Created ${pc.cyan(CONFIG_FILENAME)} — a template with comments in docs/quickstart.md.`,
    );
    out.info(
      'Fill in your benchmark command and gates, commit the file, then run `paxcli start` again.',
    );
    out.result({ createdTemplate: true, configPath });
    return;
  }

  let config = parseConfig(await readFile(configPath, 'utf8'));
  const preset = (opts.preset ?? 'quick') as PresetName;
  if (!['quick', 'balanced', 'deep'].includes(preset)) {
    throw new Error(`Unknown preset "${preset}". Use quick, balanced, or deep.`);
  }
  config = applyPreset(config, preset);
  if (opts.budget)
    config = { ...config, budget: { ...config.budget, maxCostUsd: Number(opts.budget) } };
  if (opts.parallel)
    config = { ...config, search: { ...config.search, parallel: Number(opts.parallel) } };

  const hostId = opts.host ?? config.host.id;
  const host = await createHostAdapter(hostId, opts.mockPatches);

  out.info(
    `Preset ${pc.bold(preset)}: up to ${config.search.maxNodes} experiments across ${config.search.maxRounds} round(s), ${config.search.parallel} in parallel, budget $${config.budget.maxCostUsd.toFixed(2)} (spend can overshoot by at most one active agent call).`,
  );

  const outcome = await runOptimizeWithUi({ repoRoot, config, host, out });
  if (!outcome.bestNode) process.exitCode = 1;
}

async function writeConfigTemplate(configPath: string): Promise<void> {
  const template = {
    $schema:
      'https://raw.githubusercontent.com/harikantbajaj/paxcli/main/schema/paxcli.config.schema.json',
    version: 1,
    benchmark: {
      sampleCmd: 'node bench.js',
      server: { startCmd: 'npm start', readyUrl: 'http://127.0.0.1:{port}/health' },
      metric: 'p50_latency_ms',
      direction: 'minimize',
      warmupSamples: 2,
      samples: 8,
    },
    gates: [{ id: 'tests', name: 'test suite', cmd: 'npm test', kind: 'tests' }],
    constraints: [],
    policy: {
      writable: ['src/**'],
      protected: ['paxcli.config.json', 'test/**', 'tests/**', '.github/**'],
    },
    search: { maxRounds: 3, parallel: 2, maxNodes: 8, plateauRounds: 2, minImprovementPct: 1 },
    budget: { maxCostUsd: 5 },
    host: { id: 'claude-code' },
  };
  await writeFile(configPath, JSON.stringify(template, null, 2), 'utf8');
}

async function guard(out: Output, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    out.error((err as Error).message);
    process.exitCode = 1;
  }
}

program.parseAsync(process.argv);
