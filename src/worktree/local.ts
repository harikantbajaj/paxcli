import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { type Options as ExecaOptions, execa } from 'execa';
import { paxcliDir } from '../tree/store.js';

/**
 * Local git-worktree backend. Every experiment gets an isolated checkout on a
 * namespaced branch (paxcli/exp/<id>); the main working tree is never touched.
 *
 * Branch lifecycle:
 *   rejected            -> branch deleted immediately
 *   accepted non-winner -> retained until `paxcli gc`
 *   winner              -> paxcli/winner/<run-id>, created by `paxcli apply`
 *
 * Windows note: worktree removal can hit EBUSY from antivirus or file
 * watchers, so destroy() retries with backoff before falling back to rm -rf
 * plus `git worktree prune`.
 */

export const EXP_BRANCH_PREFIX = 'paxcli/exp/';
export const WINNER_BRANCH_PREFIX = 'paxcli/winner/';

async function git(cwd: string, args: string[], opts: ExecaOptions = {}) {
  return execa('git', args, { cwd, ...opts });
}

export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await git(cwd, args);
  return String(stdout).trim();
}

/** Untrimmed variant — porcelain formats are whitespace-significant. */
export async function gitOutputRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await git(cwd, args);
  return String(stdout);
}

export interface RepoSnapshot {
  headSha: string;
  branch: string;
  /** `git status --porcelain` output at run start; later diffs compare to this. */
  statusLines: string[];
}

export async function snapshotRepo(repoRoot: string): Promise<RepoSnapshot> {
  const headSha = await gitOutput(repoRoot, ['rev-parse', 'HEAD']);
  const branch = await gitOutput(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = await gitOutputRaw(repoRoot, ['status', '--porcelain']);
  return { headSha, branch, statusLines: status.split('\n').filter((l) => l.trim()) };
}

/**
 * Files that changed in the MAIN repo since the run-start snapshot. The user
 * may legitimately edit while a run is active, so callers warn — never abort —
 * unless a protected file shows up here.
 */
export async function unexpectedMainRepoChanges(
  repoRoot: string,
  snapshot: RepoSnapshot,
): Promise<string[]> {
  const status = await gitOutputRaw(repoRoot, ['status', '--porcelain']);
  const now = new Set(status.split('\n').filter((l) => l.trim()));
  for (const line of snapshot.statusLines) now.delete(line);
  // Paxcli's own state directory is expected to appear; it is not user drift.
  return [...now].filter((line) => !line.slice(3).replace(/^"/, '').startsWith('.paxcli'));
}

export class Worktree {
  constructor(
    readonly id: string,
    readonly path: string,
    readonly branch: string,
    private readonly repoRoot: string,
  ) {}

  async commit(message: string): Promise<string> {
    await git(this.path, ['add', '-A']);
    await git(this.path, [
      '-c',
      'user.name=paxcli',
      '-c',
      'user.email=paxcli@localhost',
      'commit',
      '-m',
      message,
      '--no-verify',
    ]);
    return gitOutput(this.path, ['rev-parse', 'HEAD']);
  }

  async diff(): Promise<string> {
    await git(this.path, ['add', '-A', '-N']);
    const { stdout } = await git(this.path, ['diff', 'HEAD']);
    return String(stdout);
  }

  async changedFiles(): Promise<string[]> {
    await git(this.path, ['add', '-A', '-N']);
    const out = await gitOutput(this.path, ['diff', '--name-only', 'HEAD']);
    return out ? out.split('\n') : [];
  }

  async destroy(opts: { keepBranch: boolean }): Promise<void> {
    await removeWorktreeWithRetry(this.repoRoot, this.path);
    if (!opts.keepBranch) {
      await git(this.repoRoot, ['branch', '-D', this.branch]).catch(() => {});
    }
  }
}

export class WorktreeBackend {
  constructor(private readonly repoRoot: string) {}

  private worktreesRoot(): string {
    return path.join(paxcliDir(this.repoRoot), 'worktrees');
  }

  async provision(id: string, baseRef: string): Promise<Worktree> {
    const branch = `${EXP_BRANCH_PREFIX}${id}`;
    const dir = path.join(this.worktreesRoot(), id);
    await mkdir(this.worktreesRoot(), { recursive: true });
    await git(this.repoRoot, ['worktree', 'add', '-b', branch, dir, baseRef]);
    return new Worktree(id, dir, branch, this.repoRoot);
  }

  /** Crash-recovery sweep: remove all paxcli worktrees and prune stale refs. */
  async sweep(): Promise<string[]> {
    const removed: string[] = [];
    const root = this.worktreesRoot();
    if (existsSync(root)) {
      const { readdir } = await import('node:fs/promises');
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        await removeWorktreeWithRetry(this.repoRoot, dir);
        removed.push(entry.name);
      }
    }
    await git(this.repoRoot, ['worktree', 'prune']).catch(() => {});
    return removed;
  }

  async listExperimentBranches(): Promise<string[]> {
    const out = await gitOutput(this.repoRoot, [
      'for-each-ref',
      '--format=%(refname:short)',
      `refs/heads/${EXP_BRANCH_PREFIX}*`,
    ]);
    return out ? out.split('\n') : [];
  }

  async deleteBranches(branches: string[]): Promise<void> {
    for (const b of branches) {
      await git(this.repoRoot, ['branch', '-D', b]).catch(() => {});
    }
  }

  async createWinnerBranch(runIdValue: string, commitSha: string): Promise<string> {
    const branch = `${WINNER_BRANCH_PREFIX}${runIdValue}`;
    await git(this.repoRoot, ['branch', '-f', branch, commitSha]);
    return branch;
  }
}

async function removeWorktreeWithRetry(repoRoot: string, dir: string): Promise<void> {
  const delays = [0, 250, 1000, 3000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt] as number);
    try {
      await git(repoRoot, ['worktree', 'remove', '--force', dir]);
      return;
    } catch {
      // fall through to next attempt
    }
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await git(repoRoot, ['worktree', 'prune']).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
