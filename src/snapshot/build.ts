import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { paxcliDir } from '../tree/store.js';
import { shortId } from '../util/ids.js';

/**
 * Internal working-tree snapshots. A snapshot is a real git commit built
 * through a TEMPORARY index, so it captures committed + staged + modified +
 * untracked files exactly as they sit on disk — without ever touching the
 * user's index, branch, HEAD, or working tree. The commit is stored under
 * refs/paxcli/snapshots/<run-id>, invisible to normal git workflows, and is
 * the base every task worktree branches from. `paxcli gc` removes the refs.
 */

export const SNAPSHOT_REF_PREFIX = 'refs/paxcli/snapshots/';
export const RESULT_REF_PREFIX = 'refs/paxcli/results/';
export const INTERNAL_REF_ROOT = 'refs/paxcli/';

// Excluded from every snapshot on top of .gitignore: paxcli state, credential
// files, and dependency/build directories (worktrees reinstall dependencies —
// snapshotting them would let install artifacts masquerade as agent changes in
// repositories without a .gitignore). Git pathspec wildcards cross directory
// separators, so '*.pem' matches at any depth; bare names ('.env') only match
// at the root, hence the paired star-slash variants.
export const SNAPSHOT_EXCLUDES = [
  '.paxcli',
  '.env',
  '.env.*',
  '*/.env',
  '*/.env.*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '*/id_rsa*',
  'credentials*',
  '*/credentials*',
  'node_modules',
  '*/node_modules',
  '.venv',
  '*/.venv',
  '__pycache__',
  '*/__pycache__',
];

const SNAPSHOT_IDENTITY = {
  GIT_AUTHOR_NAME: 'paxcli',
  GIT_AUTHOR_EMAIL: 'paxcli@localhost',
  GIT_COMMITTER_NAME: 'paxcli',
  GIT_COMMITTER_EMAIL: 'paxcli@localhost',
};

export interface Snapshot {
  runId: string;
  /** Commit sha of the snapshot. */
  sha: string;
  /** Internal ref holding the commit, or null when writeRef was false. */
  ref: string | null;
  /** The user's HEAD at snapshot time (parent of the snapshot), or null on an unborn branch. */
  parentSha: string | null;
  fileCount: number;
}

async function git(cwd: string, args: string[], env?: Record<string, string>) {
  const { stdout } = await execa('git', args, { cwd, ...(env ? { env } : {}) });
  return String(stdout).trim();
}

export async function buildSnapshot(
  repoRoot: string,
  runIdValue: string,
  opts: { writeRef?: boolean } = {},
): Promise<Snapshot> {
  let parentSha: string | null = null;
  try {
    parentSha = await git(repoRoot, ['rev-parse', 'HEAD']);
  } catch {
    parentSha = null; // unborn branch — parentless snapshot commit
  }

  const tmpDir = path.join(paxcliDir(repoRoot), 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const indexFile = path.join(tmpDir, `index-${runIdValue}-${shortId(4)}`);
  const env = { GIT_INDEX_FILE: indexFile };

  try {
    // Seed the temp index from HEAD so tracked-but-ignored files stay tracked,
    // then stage the working tree exactly as it is (add -A respects .gitignore
    // for untracked files and records deletions).
    if (parentSha) await git(repoRoot, ['read-tree', parentSha], env);
    else await git(repoRoot, ['read-tree', '--empty'], env);
    await git(repoRoot, ['add', '-A'], env);
    // --cached never touches working files; --force skips the staged-content
    // safety check, which otherwise trips over .paxcli's own changing files.
    await git(
      repoRoot,
      ['rm', '--cached', '-r', '-q', '--force', '--ignore-unmatch', '--', ...SNAPSHOT_EXCLUDES],
      env,
    );

    const tree = await git(repoRoot, ['write-tree'], env);
    const commitArgs = ['commit-tree', '-m', `paxcli snapshot ${runIdValue}`];
    if (parentSha) commitArgs.push('-p', parentSha);
    commitArgs.push(tree);
    const sha = await git(repoRoot, commitArgs, { ...env, ...SNAPSHOT_IDENTITY });

    let ref: string | null = null;
    if (opts.writeRef !== false) {
      ref = `${SNAPSHOT_REF_PREFIX}${runIdValue}`;
      await git(repoRoot, ['update-ref', ref, sha]);
    }

    const names = await git(repoRoot, ['ls-tree', '-r', '--name-only', tree]);
    const fileCount = names ? names.split('\n').length : 0;
    return { runId: runIdValue, sha, ref, parentSha, fileCount };
  } finally {
    await rm(indexFile, { force: true }).catch(() => {});
  }
}

/** Records the accepted result commit so recovery works even after worktree cleanup. */
export async function writeResultRef(
  repoRoot: string,
  runIdValue: string,
  sha: string,
): Promise<string> {
  const ref = `${RESULT_REF_PREFIX}${runIdValue}`;
  await git(repoRoot, ['update-ref', ref, sha]);
  return ref;
}

export async function listInternalRefs(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, ['for-each-ref', '--format=%(refname)', INTERNAL_REF_ROOT]);
  return out ? out.split('\n') : [];
}

export async function deleteInternalRefs(repoRoot: string, refs: string[]): Promise<void> {
  for (const ref of refs) {
    await git(repoRoot, ['update-ref', '-d', ref]).catch(() => {});
  }
}

/**
 * Resolves the directory paxcli should operate on. Inside a repository this is
 * the repository root (snapshots and worktrees are repo-level operations);
 * outside one, a fresh repository is initialized in place — the user is never
 * told to run `git init` themselves.
 */
export async function ensureRepo(cwd: string): Promise<{ root: string; created: boolean }> {
  try {
    const top = await git(cwd, ['rev-parse', '--show-toplevel']);
    return { root: top, created: false };
  } catch {
    try {
      await git(cwd, ['init', '-b', 'main']);
    } catch {
      await git(cwd, ['init']); // git < 2.28 has no -b
    }
    return { root: cwd, created: true };
  }
}
