#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { CONFIG_FILENAME, type PaxcliConfig, loadConfig, parseConfig } from '../config/schema.js';
import { startFleetDashboard } from '../control-plane/server.js';
import { describeDiscovery, discoverRepo } from '../discovery/repo.js';
import { TASK_MARKER_FILENAME } from '../engine/task-loop.js';
import { createHostAdapter } from '../hosts/claude-code/adapter.js';
import { detectHosts } from '../hosts/detect.js';
import { deleteInternalRefs, listInternalRefs } from '../snapshot/build.js';
import { EventStore, runDir } from '../tree/store.js';
import { improvementPct } from '../tree/types.js';
import { GitStateError, HostUnavailableError } from '../util/errors.js';
import { EXP_BRANCH_PREFIX, WorktreeBackend, gitOutput } from '../worktree/local.js';
import { registerBenchmarkCommands } from './commands/benchmark.js';
import { registerCiCommands } from './commands/ci.js';
import { registerConfigCommands } from './commands/config.js';
import { registerLedgerCommands } from './commands/ledger.js';
import { registerRunCommands } from './commands/run.js';
import { runDemo } from './demo.js';
import { guard, recordOptimizationInLedger, resolveAcceptedNode } from './helpers.js';
import { type PresetName, applyPreset, runOptimizeWithUi } from './optimize-ui.js';
import { Output } from './output.js';
import { looksLikeInquiryRequest, looksLikePerformanceRequest, runTaskFlow } from './task-ui.js';

const program = new Command();

// The version always comes from package.json (shipped one level above dist/),
// so the CLI can never report a stale number again.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

program
  .name('paxcli')
  .description(
    'Give Paxcli a slow endpoint. Coding agents propose fixes; Paxcli returns a verified performance result you can review.',
  )
  .version(pkg.version);

// ---------------------------------------------------------------- primary --

program
  .command('task [request...]', { isDefault: true })
  .description('Ask about the repository or run a protected general coding task')
  .option('--host <id>', 'claude-code | codex | mock (default: auto-detect)')
  .option('--model <model>', 'model override for the agent')
  .option('--budget <usd>', 'maximum agent spend in USD', '5')
  .option('--mock-patches <file>', 'patch script for the mock host (testing)')
  .option('--no-ledger', 'skip recording the applied result in the Proof Ledger (PROOF.md)')
  .option('--json', 'machine-readable output on stdout')
  .option('-y, --yes', 'apply the result without asking')
  .action(async (request: string[], opts: TaskCmdOpts) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, () => taskCommand(request, opts, out));
  });

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
  .description('Find a verified performance improvement in this repository')
  .option('--preset <name>', 'quick | balanced | deep (omit to use your config values as-is)')
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
  .option('--host <id>', 'claude-code | codex | mock', 'claude-code')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean; host: string }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
      const repoRoot = process.cwd();
      const runs = await EventStore.listRuns(repoRoot);
      let target: string | null = null;
      for (const id of [...runs].reverse()) {
        // Task runs are single-shot and cannot be resumed — re-run the request instead.
        if (existsSync(path.join(runDir(repoRoot, id), TASK_MARKER_FILENAME))) continue;
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
      if (summary.reproduction) {
        out.info(
          summary.reproduction.held
            ? pc.green(`Fresh reproduction: held (${summary.reproduction.display})`)
            : pc.red(`Fresh reproduction: did NOT hold (${summary.reproduction.display})`),
        );
      }
      out.result({
        runId: latest,
        finished: summary.finished,
        reason: summary.finishReason,
        bestNodeId: summary.bestNodeId,
        reproduction: summary.reproduction,
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
  .option('--no-ledger', 'skip recording this result in the Proof Ledger (PROOF.md)')
  .option('--json', 'machine-readable output on stdout')
  .action(
    async (nodeId: string | undefined, opts: { run?: string; json?: boolean; ledger: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        const repoRoot = process.cwd();
        const winner = await resolveAcceptedNode(repoRoot, nodeId, opts.run);
        const backend = new WorktreeBackend(repoRoot);
        const branch = await backend.createWinnerBranch(winner.runId, winner.commitSha);
        out.info(
          `${pc.green('✓')} Created branch ${pc.cyan(branch)} at ${winner.commitSha.slice(0, 7)}`,
        );
        out.info(`  Hypothesis: ${winner.node.hypothesis}`);
        out.info(`  ${winner.node.decisionReason}`);
        const ledger = opts.ledger
          ? await recordOptimizationInLedger(repoRoot, winner.store, winner.nodeId, out)
          : null;
        out.info('');
        out.info('Review and merge it yourself — Paxcli never merges for you:');
        out.info(`  git diff HEAD...${branch}`);
        out.info(`  git merge ${branch}`);
        out.result({
          branch,
          commit: winner.commitSha,
          nodeId: winner.nodeId,
          runId: winner.runId,
          ledger,
        });
      });
    },
  );

program
  .command('doctor')
  .description('Check this environment and repository, with exact repair steps')
  .option('--host <id>', 'claude-code | codex | mock', 'claude-code')
  .option('--json', 'machine-readable output on stdout')
  .action(async (opts: { json?: boolean; host: string }) => {
    const out = new Output(Boolean(opts.json));
    await guard(out, async () => {
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
      const hosts = await detectHosts();
      const usable = hosts.filter((h) => h.installed && h.authenticated !== false);
      add(
        'coding agent (Claude Code or Codex)',
        usable.length > 0,
        hosts
          .map(
            (h) =>
              `${h.label}: ${
                h.installed
                  ? `${h.version ?? 'installed'}${
                      h.authenticated === true
                        ? ', signed in'
                        : h.authenticated === false
                          ? ', signed out'
                          : ''
                    }`
                  : 'not found'
              }`,
          )
          .join(' · '),
      );
      if (opts.host && opts.host !== 'claude-code') {
        const host = await createHostAdapter(opts.host);
        const detection = await host.detect();
        add(
          `host: ${opts.host}`,
          detection.found,
          detection.found ? (detection.version ?? 'ok') : (detection.problem ?? 'not found'),
        );
      }

      for (const c of checks) {
        out.info(`${c.ok ? pc.green('✓') : pc.red('✗')} ${c.name} — ${c.detail}`);
      }
      out.result({ checks });
      if (checks.some((c) => !c.ok)) process.exitCode = 1;
    });
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
      const refs = await listInternalRefs(process.cwd()).catch(() => [] as string[]);
      if (refs.length > 0) {
        await deleteInternalRefs(process.cwd(), refs);
        out.info(
          `Deleted ${refs.length} internal snapshot/result ref(s). Saved patches under .paxcli/runs/ still apply while the files they touch are unchanged.`,
        );
      }
      out.result({ removedWorktrees: removed, deletedBranches, deletedRefs: refs });
    });
  });

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
  .description('Open a live run view or the zero-footprint multi-repository fleet dashboard')
  .option('--run <runId>', 'run to view (default: latest)')
  .option('--port <port>', 'port (default: random free port)')
  .option('--fleet', 'show connected repositories and live agent activity; writes nothing to repos')
  .option('--repo <names...>', 'repository names to display initially in fleet mode')
  .action(async (opts: { run?: string; port?: string; fleet?: boolean; repo?: string[] }) => {
    const out = new Output(false);
    await guard(out, async () => {
      if (opts.fleet) {
        const handle = await startFleetDashboard({
          port: opts.port ? Number(opts.port) : 0,
          repositories: opts.repo ?? [],
        });
        out.info('Paxcli Fleet — zero-footprint multi-repository agent dashboard:');
        out.info(`  ${pc.cyan(handle.url)}`);
        out.info(
          pc.dim(
            'Memory-only in this process. No config, JSON, receipt, or hidden file is written to connected repositories.',
          ),
        );
        out.info('');
        out.info('To stream Paxcli runs from another terminal without adding repository files:');
        if (process.platform === 'win32') {
          out.info(`  ${pc.cyan(`$env:PAXCLI_FLEET_URL='${handle.url}'`)}`);
        } else {
          out.info(`  ${pc.cyan(`export PAXCLI_FLEET_URL='${handle.url}'`)}`);
        }
        out.info(`  ${pc.cyan('paxcli start')}`);
        await new Promise(() => {});
        return;
      }
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
      const winner = await resolveAcceptedNode(repoRoot, nodeId, opts.run);
      const backend = new WorktreeBackend(repoRoot);
      const branch = await backend.createWinnerBranch(winner.runId, winner.commitSha);

      const { buildRunReport } = await import('../report/markdown.js');
      const body = await buildRunReport({
        summary: winner.summary,
        receiptsDir: winner.store.receiptsDir(),
      });

      try {
        await execa('gh', ['--version']);
      } catch {
        throw new HostUnavailableError(
          'GitHub CLI (gh) not found.',
          'Install it from https://cli.github.com and run `gh auth login` — or push the branch and open the PR manually.',
        );
      }

      out.status(`Pushing ${branch} and opening a PR (nothing is merged without your review)`);
      await execa('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
      const title = `perf: ${winner.node.hypothesis.slice(0, 70)}`;
      const { stdout } = await execa(
        'gh',
        ['pr', 'create', '--head', branch, '--title', title, '--body', body],
        { cwd: repoRoot },
      );
      out.info(`${pc.green('✓')} PR opened: ${String(stdout).trim()}`);
    });
  });

// ----------------------------------------------------------- sub-groups ----

registerRunCommands(program);
registerBenchmarkCommands(program);
registerCiCommands(program);
registerConfigCommands(program);
registerLedgerCommands(program);

// ------------------------------------------------------------------- task --

interface TaskCmdOpts {
  host?: string;
  model?: string;
  budget?: string;
  mockPatches?: string;
  ledger?: boolean;
  json?: boolean;
  yes?: boolean;
}

async function taskCommand(request: string[], opts: TaskCmdOpts, out: Output): Promise<void> {
  let task = request.join(' ').trim();
  if (!task) {
    if (opts.json || !process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Describe the change: paxcli "improve the form-submission page UI"');
    }
    const { text, isCancel } = await import('@clack/prompts');
    const answer = await text({
      message: 'What do you want to change?',
      placeholder: 'e.g. Improve the form-submission page UI and make it responsive',
    });
    if (isCancel(answer) || !String(answer ?? '').trim()) return;
    task = String(answer).trim();
  }

  const cwd = process.cwd();

  // Performance-flavored requests use the verified optimization engine when a
  // benchmark exists; otherwise task mode runs with an honest "not measured" note.
  if (!looksLikeInquiryRequest(task) && looksLikePerformanceRequest(task)) {
    let config: PaxcliConfig | null = null;
    try {
      config = await loadConfig(cwd);
    } catch {
      config = null;
    }
    if (config) {
      out.info(
        'This looks like a performance request and a benchmark is configured — running the verified optimization engine.',
      );
      const host = await createHostAdapter(opts.host ?? config.host.id, opts.mockPatches);
      const outcome = await runOptimizeWithUi({
        repoRoot: cwd,
        config,
        host,
        out,
        extraSteering: `The user's specific request: ${task}`,
      });
      if (!outcome.bestNode) process.exitCode = 1;
      return;
    }
    out.info(
      'Performance-flavored request, but no benchmark is configured — running in task mode. Checks can pass, but the speedup will NOT be measured. Configure paxcli.config.json for verified optimization.',
    );
  }

  await runTaskFlow({
    cwd,
    request: task,
    out,
    ...(opts.host ? { hostId: opts.host } : {}),
    ...(opts.mockPatches ? { mockPatchesFile: opts.mockPatches } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.budget ? { budgetUsd: Number(opts.budget) } : {}),
    ...(opts.yes ? { yes: true } : {}),
    ledger: opts.ledger !== false,
  });
}

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
    throw new GitStateError(
      'This directory is not a git repository with a commit.',
      'Run `git init && git add -A && git commit -m baseline` first.',
    );
  }

  const configPath = path.join(repoRoot, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    const discovery = await discoverRepo(repoRoot);
    await writeConfigTemplate(configPath, discovery);
    out.info(`Created ${pc.cyan(CONFIG_FILENAME)} with the checks Paxcli discovered.`);
    out.info(describeDiscovery(discovery));
    out.info(
      'Guide with examples: https://github.com/harikantbajaj/paxcli/blob/main/docs/quickstart.md',
    );
    out.info(
      'Set the benchmark command and target endpoint, review the protected paths, then run `paxcli benchmark validate`.',
    );
    out.result({ createdTemplate: true, configPath });
    return;
  }

  let config = parseConfig(await readFile(configPath, 'utf8'));
  const preset = opts.preset as PresetName | undefined;
  if (preset !== undefined) {
    if (!['quick', 'balanced', 'deep'].includes(preset)) {
      throw new Error(`Unknown preset "${preset}". Use quick, balanced, or deep.`);
    }
    config = applyPreset(config, preset);
  }
  if (opts.budget)
    config = { ...config, budget: { ...config.budget, maxCostUsd: Number(opts.budget) } };
  if (opts.parallel)
    config = { ...config, search: { ...config.search, parallel: Number(opts.parallel) } };

  const hostId = opts.host ?? config.host.id;
  const host = await createHostAdapter(hostId, opts.mockPatches);

  out.info(
    `${preset ? `Preset ${pc.bold(preset)} (overrides your config's search/budget)` : 'Using your config settings'}: ` +
      `up to ${config.search.maxNodes} experiments across ${config.search.maxRounds} round(s), ${config.search.parallel} in parallel, budget $${config.budget.maxCostUsd.toFixed(2)} ` +
      `(the budget is checked before each spawn; spend can overshoot by up to ${config.search.parallel} in-flight agent call${config.search.parallel > 1 ? 's' : ''}).`,
  );

  const outcome = await runOptimizeWithUi({ repoRoot, config, host, out });
  if (!outcome.bestNode) process.exitCode = 1;
}

async function writeConfigTemplate(
  configPath: string,
  discovery: Awaited<ReturnType<typeof discoverRepo>>,
): Promise<void> {
  const gates = (['typecheck', 'lint', 'test', 'build'] as const).flatMap((kind) => {
    const detected = discovery.commands[kind];
    return detected
      ? [
          {
            id: kind,
            name: kind === 'test' ? 'test suite' : kind,
            cmd: detected.cmd,
            kind: kind === 'test' ? 'tests' : 'custom',
          },
        ]
      : [];
  });
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
    gates,
    constraints: [],
    policy: {
      writable: ['src/**'],
      protected: discovery.protectedGlobs,
    },
    search: { maxRounds: 3, parallel: 2, maxNodes: 8, plateauRounds: 2, minImprovementPct: 1 },
    budget: { maxCostUsd: 5 },
    host: { id: 'claude-code' },
    ledger: { enabled: true, path: 'PROOF.md' },
  };
  await writeFile(configPath, JSON.stringify(template, null, 2), 'utf8');
}

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
