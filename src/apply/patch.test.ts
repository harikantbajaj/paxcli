import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../snapshot/build.js';
import { applyTaskResult } from './patch.js';

/**
 * Application invariants: agent-only changes land in the working directory,
 * pre-existing user edits survive, and a real conflict never overwrites the
 * user's version (and never leaves conflict markers behind).
 */

let root: string;

const git = (args: string[], cwd = root) => execa('git', args, { cwd });
const gitOut = async (args: string[], cwd = root) => String((await git(args, cwd)).stdout).trim();
const commit = (cwd = root) =>
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c', '--no-verify'], cwd);

const NUMBERED = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n');

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-apply-'));
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'target.txt'), `${NUMBERED}\n`);
  await writeFile(path.join(root, 'other.txt'), 'other original\n');
  await git(['add', '-A']);
  await commit();
});

/** Simulates an accepted task run: snapshot → worktree edit → commit → patch. */
async function makeResult(
  runIdValue: string,
  edit: (wtPath: string) => Promise<void>,
): Promise<{ snapshotSha: string; resultSha: string; patchPath: string }> {
  const snap = await buildSnapshot(root, runIdValue);
  const wtPath = path.join(root, '.paxcli', 'worktrees', runIdValue);
  await git(['worktree', 'add', '-b', `paxcli/exp/${runIdValue}`, wtPath, snap.sha]);
  await edit(wtPath);
  await git(['add', '-A'], wtPath);
  await commit(wtPath);
  const resultSha = await gitOut(['rev-parse', 'HEAD'], wtPath);
  const { stdout } = await git(['diff', '--binary', snap.sha, resultSha]);
  const patchPath = path.join(root, '.paxcli', `agent-${runIdValue}.patch`);
  await writeFile(patchPath, `${String(stdout)}\n`);
  await git(['worktree', 'remove', '--force', wtPath]);
  return { snapshotSha: snap.sha, resultSha, patchPath };
}

describe('applyTaskResult', () => {
  it('applies agent-only changes and preserves unrelated user edits', async () => {
    const result = await makeResult('r1', async (wt) => {
      await writeFile(
        path.join(wt, 'target.txt'),
        `${NUMBERED.replace('line 10', 'line 10 improved')}\n`,
      );
      await writeFile(path.join(wt, 'new.txt'), 'brand new\n');
    });
    // User edits an unrelated file while the run was active.
    await writeFile(path.join(root, 'other.txt'), 'user edit\n');
    const headBefore = await gitOut(['rev-parse', 'HEAD']);

    const applied = await applyTaskResult({ repoRoot: root, runId: 'r1', ...result });

    expect(applied.applied).toBe(true);
    expect(applied.method).toBe('clean');
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toContain('line 10 improved');
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toContain('brand new');
    expect(await readFile(path.join(root, 'other.txt'), 'utf8')).toBe('user edit\n');
    // Working tree only: no commit, nothing staged.
    expect(await gitOut(['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(await gitOut(['diff', '--cached', '--name-only'])).toBe('');
  }, 60_000);

  it('never overwrites a conflicting user edit and reports the file', async () => {
    const result = await makeResult('r2', async (wt) => {
      await writeFile(
        path.join(wt, 'target.txt'),
        `${NUMBERED.replace('line 10', 'agent version')}\n`,
      );
    });
    // User rewrites the SAME line while the run was active.
    const userVersion = `${NUMBERED.replace('line 10', 'user version')}\n`;
    await writeFile(path.join(root, 'target.txt'), userVersion);

    const applied = await applyTaskResult({ repoRoot: root, runId: 'r2', ...result });

    expect(applied.applied).toBe(false);
    expect(applied.conflicts).toContain('target.txt');
    const content = await readFile(path.join(root, 'target.txt'), 'utf8');
    expect(content).toBe(userVersion);
    expect(content).not.toContain('<<<<<<<'); // no conflict markers, ever
  }, 60_000);

  it('merges when the user edited nearby but non-conflicting lines', async () => {
    const result = await makeResult('r3', async (wt) => {
      await writeFile(
        path.join(wt, 'target.txt'),
        `${NUMBERED.replace('line 10', 'agent line 10')}\n`,
      );
    });
    // Line 7 sits inside the patch hunk's context, so strict apply fails,
    // but a three-way merge is clean.
    await writeFile(
      path.join(root, 'target.txt'),
      `${NUMBERED.replace('line 7', 'user line 7')}\n`,
    );

    const applied = await applyTaskResult({ repoRoot: root, runId: 'r3', ...result });

    expect(applied.applied).toBe(true);
    expect(applied.method).toBe('merge');
    const content = await readFile(path.join(root, 'target.txt'), 'utf8');
    expect(content).toContain('user line 7');
    expect(content).toContain('agent line 10');
  }, 60_000);
});
