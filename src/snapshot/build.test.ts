import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, deleteInternalRefs, ensureRepo, listInternalRefs } from './build.js';

/**
 * Snapshot invariants: everything on disk (minus ignores and secrets) lands in
 * the snapshot commit, and the user's repository state is bit-for-bit
 * untouched. The temp dir name contains a space on purpose — Windows paths
 * with spaces must work.
 */

let root: string;

const git = (args: string[], cwd = root) => execa('git', args, { cwd });
const gitOut = async (args: string[], cwd = root) => String((await git(args, cwd)).stdout).trim();
const commit = () =>
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c', '--no-verify']);
const showFile = async (sha: string, file: string) =>
  execa('git', ['show', `${sha}:${file}`], { cwd: root, reject: false });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli snap-'));
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'a.txt'), 'one\n');
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
  await git(['add', '-A']);
  await commit();
});

describe('buildSnapshot', () => {
  it('captures committed, modified, and untracked files; excludes ignored and secret files', async () => {
    await writeFile(path.join(root, 'a.txt'), 'two\n');
    await writeFile(path.join(root, 'b.txt'), 'untracked\n');
    await writeFile(path.join(root, 'ignored.txt'), 'nope\n');
    await writeFile(path.join(root, '.env'), 'SECRET=1\n');
    await mkdir(path.join(root, 'sub'));
    await writeFile(path.join(root, 'sub', '.env'), 'SECRET=2\n');
    await writeFile(path.join(root, 'sub', 'server.pem'), 'KEY\n');

    const snap = await buildSnapshot(root, 'run1');
    expect(snap.parentSha).toBe(await gitOut(['rev-parse', 'HEAD']));

    expect(String((await showFile(snap.sha, 'a.txt')).stdout)).toContain('two');
    expect((await showFile(snap.sha, 'b.txt')).exitCode).toBe(0);
    expect((await showFile(snap.sha, 'ignored.txt')).exitCode).not.toBe(0);
    expect((await showFile(snap.sha, '.env')).exitCode).not.toBe(0);
    expect((await showFile(snap.sha, 'sub/.env')).exitCode).not.toBe(0);
    expect((await showFile(snap.sha, 'sub/server.pem')).exitCode).not.toBe(0);
  }, 30_000);

  it('never modifies the user HEAD, branch, index, or working tree', async () => {
    await writeFile(path.join(root, 'a.txt'), 'dirty\n');
    await writeFile(path.join(root, 'b.txt'), 'untracked\n');
    const headBefore = await gitOut(['rev-parse', 'HEAD']);
    const branchBefore = await gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
    const statusBefore = String((await git(['status', '--porcelain'])).stdout);

    const snap = await buildSnapshot(root, 'run2');

    expect(await gitOut(['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(await gitOut(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(branchBefore);
    expect(String((await git(['status', '--porcelain'])).stdout)).toBe(statusBefore);
    expect(snap.ref).toBe('refs/paxcli/snapshots/run2');
    expect(await listInternalRefs(root)).toContain('refs/paxcli/snapshots/run2');

    await deleteInternalRefs(root, ['refs/paxcli/snapshots/run2']);
    expect(await listInternalRefs(root)).toEqual([]);
  }, 30_000);

  it('handles a repository with no commits (unborn HEAD)', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'paxcli snap-unborn-'));
    await git(['init', '-b', 'main'], bare);
    await writeFile(path.join(bare, 'new.txt'), 'hello\n');
    const snap = await buildSnapshot(bare, 'run3');
    expect(snap.parentSha).toBeNull();
    const shown = await execa('git', ['show', `${snap.sha}:new.txt`], { cwd: bare });
    expect(String(shown.stdout)).toContain('hello');
  }, 30_000);
});

describe('ensureRepo', () => {
  it('finds the repository root and never re-inits an existing repo', async () => {
    const sub = path.join(root, 'sub2');
    await mkdir(sub);
    const res = await ensureRepo(sub);
    expect(res.created).toBe(false);
    // Compare through git's own normalization (Windows 8.3 short names differ from path.resolve).
    expect(res.root).toBe(await gitOut(['rev-parse', '--show-toplevel']));
  });

  it('initializes a repository when there is none', async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), 'paxcli snap-fresh-'));
    const res = await ensureRepo(fresh);
    expect(res.created).toBe(true);
    await execa('git', ['rev-parse', '--git-dir'], { cwd: fresh });
  });
});
