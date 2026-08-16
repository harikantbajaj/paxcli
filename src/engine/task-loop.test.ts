import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTaskResult } from '../apply/patch.js';
import type { RepoDiscovery } from '../discovery/repo.js';
import { MockHostAdapter } from '../hosts/mock/adapter.js';
import { cleanupTaskWorktree, runTask } from './task-loop.js';

/**
 * Task engine on the mock host: the deterministic way to exercise the repair
 * loop, pin enforcement, and honest labeling without any API keys.
 */

let root: string;

const git = (args: string[], cwd = root) => execa('git', args, { cwd });
const gitOut = async (args: string[], cwd = root) => String((await git(args, cwd)).stdout).trim();
const commit = () =>
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c', '--no-verify']);

const CHECK_JS = [
  "const { readFileSync } = require('node:fs');",
  "process.exit(readFileSync('app.js', 'utf8').includes('fixed') ? 0 : 1);",
].join('\n');

function discovery(overrides: Partial<RepoDiscovery> = {}): RepoDiscovery {
  return {
    language: 'node',
    packageManager: null,
    installCmd: null,
    commands: { test: { cmd: 'node check.cjs', source: 'test fixture' } },
    protectedGlobs: ['tests/**'],
    notes: [],
    ...overrides,
  };
}

function taskOpts(host: MockHostAdapter, d: RepoDiscovery) {
  return {
    repoRoot: root,
    task: 'make the app work',
    host,
    discovery: d,
    signal: new AbortController().signal,
    onStatus: () => {},
    installDeps: false,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-task-'));
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'app.js'), 'broken\n');
  await writeFile(path.join(root, 'check.cjs'), CHECK_JS);
  await mkdir(path.join(root, 'tests'));
  await writeFile(path.join(root, 'tests', 't.js'), 'existing test\n');
  await git(['add', '-A']);
  await commit();
});

describe('runTask', () => {
  it('repairs after a failing check, succeeds, and leaves the user repo untouched until apply', async () => {
    const host = new MockHostAdapter([
      { hypothesis: 'first try', files: { 'app.js': 'still broken\n' } },
      { hypothesis: 'second try', files: { 'app.js': 'now fixed\n' } },
    ]);
    const outcome = await runTask(taskOpts(host, discovery()));

    expect(outcome.status).toBe('succeeded');
    expect(outcome.attempts).toBe(2); // one implementation + one repair
    expect(outcome.checks.every((c) => c.pass)).toBe(true);
    expect(outcome.changedFiles).toContain('app.js');
    expect(outcome.resultSha).toBeTruthy();
    expect(outcome.patchPath && existsSync(outcome.patchPath)).toBe(true);
    // No performance-verification vocabulary for subjective work.
    expect(outcome.reason).not.toMatch(/Measured|Validated|Equivalent|Reproduced/);
    // The user's working directory is untouched until apply.
    expect(await readFile(path.join(root, 'app.js'), 'utf8')).toBe('broken\n');

    const applied = await applyTaskResult({
      repoRoot: root,
      runId: outcome.runId,
      snapshotSha: outcome.snapshotSha as string,
      resultSha: outcome.resultSha as string,
      patchPath: outcome.patchPath as string,
    });
    expect(applied.applied).toBe(true);
    // Line endings follow the user's core.autocrlf setting — compare content only.
    const appliedContent = await readFile(path.join(root, 'app.js'), 'utf8');
    expect(appliedContent.replace(/\r\n/g, '\n')).toBe('now fixed\n');
    expect(await gitOut(['diff', '--cached', '--name-only'])).toBe(''); // nothing staged
    await cleanupTaskWorktree(root, outcome);
    expect(outcome.worktreePath).toBeNull();
  }, 120_000);

  it('fails honestly when repairs run out, keeping the attempt for inspection', async () => {
    const host = new MockHostAdapter([
      { hypothesis: 'nope', files: { 'app.js': 'still broken\n' } },
    ]);
    const outcome = await runTask({ ...taskOpts(host, discovery()), maxRepairs: 1 });

    expect(outcome.status).toBe('failed');
    expect(outcome.attempts).toBe(2);
    expect(outcome.reason).toContain('still fails');
    expect(outcome.worktreePath && existsSync(outcome.worktreePath)).toBe(true);
    expect(await readFile(path.join(root, 'app.js'), 'utf8')).toBe('broken\n');
    await cleanupTaskWorktree(root, outcome);
  }, 120_000);

  it('rejects any edit to a protected file, no matter what checks say', async () => {
    const host = new MockHostAdapter([
      {
        hypothesis: 'cheat',
        files: { 'app.js': 'now fixed\n', 'tests/t.js': 'gutted\n' },
      },
    ]);
    const outcome = await runTask(taskOpts(host, discovery()));

    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toContain('tests/t.js');
    expect(await readFile(path.join(root, 'tests', 't.js'), 'utf8')).toBe('existing test\n');
  }, 120_000);

  it('succeeds with an explicit warning when no validation commands exist', async () => {
    const host = new MockHostAdapter([
      { hypothesis: 'blind change', files: { 'app.js': 'now fixed\n' } },
    ]);
    const outcome = await runTask(taskOpts(host, discovery({ commands: {} })));

    expect(outcome.status).toBe('succeeded');
    expect(outcome.checksSkipped).toBe(true);
    expect(outcome.checks).toEqual([]);
    expect(outcome.reason).toContain('NOT tested');
    await cleanupTaskWorktree(root, outcome);
  }, 120_000);

  it('answers repository questions successfully without requiring changes or running checks', async () => {
    const host = new MockHostAdapter([{ hypothesis: 'The app reads app.js.', files: {} }]);
    const outcome = await runTask({
      ...taskOpts(host, discovery()),
      task: 'tell me how this product works',
      intent: 'inquiry',
    });

    expect(outcome.status).toBe('succeeded');
    expect(outcome.intent).toBe('inquiry');
    expect(outcome.reason).toContain('without changing any files');
    expect(outcome.checks).toEqual([]);
    expect(outcome.changedFiles).toEqual([]);
    expect(outcome.resultSha).toBeNull();
    expect(outcome.worktreePath).toBeNull();
  }, 120_000);

  it('rejects file changes made while answering a repository question', async () => {
    const host = new MockHostAdapter([
      { hypothesis: 'unrequested edit', files: { 'app.js': 'now fixed\n' } },
    ]);
    const outcome = await runTask({
      ...taskOpts(host, discovery()),
      task: 'explain how this product works',
      intent: 'inquiry',
    });

    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toContain('file changes were not authorized');
    expect(await readFile(path.join(root, 'app.js'), 'utf8')).toBe('broken\n');
  }, 120_000);
});
