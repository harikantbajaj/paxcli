/**
 * Static reward-hack detectors that run over an experiment's diff, after
 * integrity pins and before acceptance. Two severities:
 *
 *  - violation: classic cheating techniques → the experiment is rejected.
 *  - suspicion: patterns that are sometimes legitimate → recorded on the
 *    receipt as remaining risks for the human reviewer, never auto-rejected.
 *
 * These are layered defenses that DETECT AND REDUCE common techniques; they
 * make no claim of catching every possible manipulation.
 */

export interface DetectorFinding {
  detector: string;
  severity: 'violation' | 'suspicion';
  detail: string;
}

interface DiffFile {
  path: string;
  addedLines: string[];
  removedLines: string[];
}

/** Parses a unified diff into per-file added/removed lines. */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  for (const line of diff.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = { path: (header[2] as string).trim(), addedLines: [], removedLines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.addedLines.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---'))
      current.removedLines.push(line.slice(1));
  }
  return files;
}

const SKIP_PATTERNS = [
  /\b(?:it|test|describe)\s*\.\s*skip\s*\(/,
  /\bx(?:it|test|describe)\s*\(/,
  /\.only\s*\(/,
  /@pytest\.mark\.skip/,
  /@Disabled\b/,
];

const CLOCK_PATTERNS = [
  /\bDate\s*\.\s*now\s*=/,
  /\bperformance\s*\.\s*now\s*=/,
  /\bprocess\s*\.\s*hrtime\s*=/,
  /\bMath\s*\.\s*random\s*=/,
  /useFakeTimers/,
];

const LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
];

const SUPPRESSION_PATTERNS = [
  /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
  /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/,
];

export function runDetectors(
  diff: string,
  opts: { allowDependencyChanges: boolean },
): DetectorFinding[] {
  const findings: DetectorFinding[] = [];
  const files = parseDiff(diff);

  for (const file of files) {
    const added = file.addedLines.join('\n');

    for (const p of SKIP_PATTERNS) {
      if (p.test(added)) {
        findings.push({
          detector: 'skipped-tests',
          severity: 'violation',
          detail: `${file.path}: adds a test-skip/only pattern (${p.source})`,
        });
        break;
      }
    }

    for (const p of CLOCK_PATTERNS) {
      if (p.test(added)) {
        findings.push({
          detector: 'timing-manipulation',
          severity: 'violation',
          detail: `${file.path}: monkey-patches a timing or randomness source`,
        });
        break;
      }
    }

    if (LOCKFILES.some((l) => file.path === l || file.path.endsWith(`/${l}`))) {
      findings.push({
        detector: 'dependency-change',
        severity: opts.allowDependencyChanges ? 'suspicion' : 'violation',
        detail: `${file.path}: lockfile changed${opts.allowDependencyChanges ? ' (allowed by policy — review the new dependencies)' : ' but the policy forbids dependency changes'}`,
      });
    }

    for (const p of SUPPRESSION_PATTERNS) {
      if (p.test(added)) {
        findings.push({
          detector: 'suppressed-errors',
          severity: 'suspicion',
          detail: `${file.path}: adds an empty catch — verify errors are not being hidden`,
        });
        break;
      }
    }

    const removedAsserts = file.removedLines.filter((l) =>
      /\b(?:assert|expect)\s*[.(]/.test(l),
    ).length;
    const addedAsserts = file.addedLines.filter((l) => /\b(?:assert|expect)\s*[.(]/.test(l)).length;
    if (removedAsserts > 0 && removedAsserts > addedAsserts) {
      findings.push({
        detector: 'weakened-assertions',
        severity: 'suspicion',
        detail: `${file.path}: removes ${removedAsserts - addedAsserts} more assertion(s) than it adds`,
      });
    }
  }
  return findings;
}
