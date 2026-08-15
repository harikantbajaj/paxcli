import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { buildSnapshot } from '../snapshot/build.js';

/**
 * Safe application of an accepted task result to the user's working directory.
 * Order of attack:
 *
 *  1. Strict `git apply --check` of the recorded patch — succeeds whenever the
 *     touched regions are still as the snapshot saw them.
 *  2. Otherwise a real three-way merge computed entirely OUT of the working
 *     tree (`git merge-tree --write-tree`, snapshot as base, a fresh snapshot
 *     of the current tree as "ours", the result as "theirs"). Clean merge →
 *     apply exactly the delta; any conflict → touch nothing and report the
 *     files. Conflict markers are never written into the user's files.
 *
 * The working tree is the only thing modified — never the index, branch, or
 * history.
 */

export interface ApplyResult {
  applied: boolean;
  method: 'clean' | 'merge' | null;
  conflicts: string[];
  /** Set when application was impossible for an environmental reason. */
  problem: string | null;
}

async function git(cwd: string, args: string[]) {
  return execa('git', args, { cwd, reject: false, all: true });
}

export async function applyTaskResult(params: {
  repoRoot: string;
  runId: string;
  snapshotSha: string;
  resultSha: string;
  patchPath: string;
}): Promise<ApplyResult> {
  const { repoRoot, snapshotSha, resultSha, patchPath } = params;

  // 1. Fast path: the affected regions are untouched since the snapshot.
  const check = await git(repoRoot, ['apply', '--check', patchPath]);
  if (check.exitCode === 0) {
    const apply = await git(repoRoot, ['apply', patchPath]);
    if (apply.exitCode !== 0) {
      return {
        applied: false,
        method: null,
        conflicts: [],
        problem: `git apply failed unexpectedly: ${String(apply.all ?? '').slice(-500)}`,
      };
    }
    return { applied: true, method: 'clean', conflicts: [], problem: null };
  }

  // 2. The user edited affected files while the run was active — merge out of tree.
  const current = await buildSnapshot(repoRoot, `${params.runId}-apply`, { writeRef: false });
  const merge = await git(repoRoot, [
    'merge-tree',
    '--write-tree',
    `--merge-base=${snapshotSha}`,
    current.sha,
    resultSha,
  ]);
  if (merge.exitCode !== 0 && merge.exitCode !== 1) {
    // git < 2.38 has no --write-tree; be conservative rather than clever.
    return {
      applied: false,
      method: null,
      conflicts: [],
      problem:
        'Your files changed while paxcli was working, and this git version cannot merge safely (needs git >= 2.38). Nothing was modified.',
    };
  }
  const lines = String(merge.stdout ?? '').split('\n');
  const mergedTree = (lines[0] ?? '').trim();
  if (merge.exitCode === 1) {
    const conflicts = [
      ...new Set(
        lines
          .slice(1)
          .filter((l) => l.includes('\t'))
          .map((l) => l.slice(l.indexOf('\t') + 1).trim())
          .filter(Boolean),
      ),
    ];
    return { applied: false, method: null, conflicts, problem: null };
  }

  const { stdout: delta } = await execa('git', ['diff', '--binary', current.sha, mergedTree], {
    cwd: repoRoot,
  });
  if (!String(delta).trim()) {
    return { applied: true, method: 'merge', conflicts: [], problem: null };
  }
  const mergePatch = path.join(path.dirname(patchPath), 'apply-merge.patch');
  await writeFile(mergePatch, `${String(delta)}\n`, 'utf8');
  const apply = await git(repoRoot, ['apply', mergePatch]);
  if (apply.exitCode !== 0) {
    return {
      applied: false,
      method: null,
      conflicts: [],
      problem: `Files changed again during application; nothing was modified. (${String(apply.all ?? '').slice(-300)})`,
    };
  }
  return { applied: true, method: 'merge', conflicts: [], problem: null };
}
