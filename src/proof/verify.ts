import type { Worktree } from '../worktree/local.js';
import { runDetectors } from './detectors.js';
import { type PinSet, verifyPins } from './pins.js';

/**
 * Shared candidate screening — the verification prefix both engines run the
 * moment an agent stops, before any score exists:
 *
 *   integrity pins → changed-files check → static reward-hack detectors
 *
 * Later stages differ by engine (benchmark/constraints/withheld for optimize,
 * discovered checks with a repair loop for tasks) and stay in their loops.
 * The evaluator is deterministic engine code either way.
 */

export type ScreenResult =
  /** A protected file was touched. Auto-reject, no score is ever computed. */
  | { verdict: 'pin-violation'; files: string }
  /** The agent produced no diff. */
  | { verdict: 'no-changes' }
  /** A violation-severity detector fired (skipped tests, clock tampering, …). */
  | { verdict: 'detector-violation'; detector: string; detail: string }
  /** Screening passed; suspicions are review flags for the receipt. */
  | { verdict: 'clean'; changedFiles: string[]; suspicions: string[] };

export async function screenCandidate(params: {
  worktree: Worktree;
  pins: PinSet;
  allowDependencyChanges: boolean;
}): Promise<ScreenResult> {
  const violations = await verifyPins(params.worktree.path, params.pins);
  if (violations.length > 0) {
    return {
      verdict: 'pin-violation',
      files: violations.map((v) => `${v.file} (${v.kind})`).join(', '),
    };
  }

  const changedFiles = await params.worktree.changedFiles();
  if (changedFiles.length === 0) return { verdict: 'no-changes' };

  const findings = runDetectors(await params.worktree.diff(), {
    allowDependencyChanges: params.allowDependencyChanges,
  });
  const violation = findings.find((f) => f.severity === 'violation');
  if (violation) {
    return {
      verdict: 'detector-violation',
      detector: violation.detector,
      detail: violation.detail,
    };
  }
  return {
    verdict: 'clean',
    changedFiles,
    suspicions: findings
      .filter((f) => f.severity === 'suspicion')
      .map((f) => `${f.detector}: ${f.detail}`),
  };
}
