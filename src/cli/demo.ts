import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import pc from 'picocolors';
import { parseConfig } from '../config/schema.js';
import type { RunOutcome } from '../engine/run-loop.js';
import { MockHostAdapter, loadMockPatches } from '../hosts/mock/adapter.js';
import { shortId } from '../util/ids.js';
import { runOptimizeWithUi } from './optimize-ui.js';
import type { Output } from './output.js';

/**
 * `paxcli demo` — the complete experience in under five minutes, no API keys:
 * copies the bundled slow API into a temp repo, then a scripted mock agent
 * tries three ideas. Two are classic reward hacks (benchmark tampering and a
 * hard-coded response) that the Proof Layer visibly rejects; the third is a
 * real algorithmic fix that gets accepted with a Verification Card.
 */
export async function runDemo(out: Output): Promise<RunOutcome> {
  const examplesDir = findExamplesDir();
  const demoSrc = path.join(examplesDir, 'demo-api');
  const patchesFile = path.join(examplesDir, 'demo-patches.json');

  const workDir = path.join(tmpdir(), `paxcli-demo-${shortId(6)}`);
  await mkdir(workDir, { recursive: true });
  await cp(demoSrc, workDir, { recursive: true });

  out.info(pc.bold('Paxcli demo — verified optimization on a deliberately slow API'));
  out.info(`Demo repository: ${workDir}`);
  out.info('Watch for the two cheating attempts the Proof Layer rejects.\n');

  const demoConfig = {
    version: 1,
    benchmark: {
      sampleCmd: 'node bench.js',
      server: { startCmd: 'node server.js', readyUrl: 'http://127.0.0.1:{port}/health' },
      metric: 'report_latency_ms',
      direction: 'minimize',
      warmupSamples: 1,
      samples: 5,
    },
    gates: [
      { id: 'tests', name: 'unit tests', cmd: 'node test.js', kind: 'tests' },
      { id: 'equiv', name: 'output equivalence', cmd: 'node verify.js', kind: 'equivalence' },
    ],
    policy: {
      writable: ['lib.js', 'server.js'],
      protected: ['paxcli.config.json', 'bench.js', 'test.js', 'verify.js', 'expected-report.json'],
    },
    search: { maxRounds: 2, parallel: 2, maxNodes: 3, plateauRounds: 2, minImprovementPct: 5 },
    budget: { maxCostUsd: 1 },
    host: { id: 'mock' },
  };
  await writeFile(path.join(workDir, 'paxcli.config.json'), JSON.stringify(demoConfig, null, 2));
  await writeFile(path.join(workDir, '.gitignore'), '.paxcli/\nnode_modules/\n');

  const git = (args: string[]) => execa('git', args, { cwd: workDir });
  await git(['init', '-b', 'main']);
  await git(['add', '-A']);
  await git([
    '-c',
    'user.name=paxcli-demo',
    '-c',
    'user.email=demo@paxcli.local',
    'commit',
    '-m',
    'demo baseline',
    '--no-verify',
  ]);

  const config = parseConfig(await readFile(path.join(workDir, 'paxcli.config.json'), 'utf8'));
  const host = new MockHostAdapter(await loadMockPatches(patchesFile));

  const outcome = await runOptimizeWithUi({
    repoRoot: workDir,
    config,
    host,
    out,
    showPermissions: true,
  });

  out.info('');
  out.info(pc.dim(`The demo repo (with receipts under .paxcli/) is kept at: ${workDir}`));
  out.info(
    pc.dim('On your own repository, `paxcli start` runs this same loop with a real coding agent.'),
  );
  return outcome;
}

function findExamplesDir(): string {
  // Works from dist/ (published package) and from src/cli/ (dev/test runs).
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.join(here, '..', 'examples'),
    path.join(here, '..', '..', 'examples'),
    path.join(here, '..', '..', '..', 'examples'),
  ]) {
    if (existsSync(path.join(candidate, 'demo-api', 'server.js'))) return candidate;
  }
  throw new Error('Could not locate the bundled examples directory');
}
