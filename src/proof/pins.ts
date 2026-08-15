import path from 'node:path';
import { glob } from 'tinyglobby';
import { gitOutput, gitOutputRaw } from '../worktree/local.js';

/**
 * Integrity pins: git blob hashes of protected files, captured before agents
 * run and verified BEFORE any score is computed. A changed protected file
 * rejects the experiment outright — the most common reward-hack (editing the
 * benchmark or weakening a test) dies here, visibly.
 *
 * Blob hashes (rather than raw file bytes) make verification immune to
 * line-ending normalization differences between checkouts on Windows.
 *
 * This is one defense layer, not a guarantee; see docs/trust-boundary.md.
 */

export interface PinSet {
  /** repo-relative path (posix separators) -> git blob sha at capture time */
  files: Record<string, string>;
}

export async function capturePins(root: string, protectedGlobs: string[]): Promise<PinSet> {
  const matched = await glob(protectedGlobs, {
    cwd: root,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '.git/**', '.paxcli/**'],
  });
  const wanted = new Set(matched.map((p) => p.replaceAll('\\', '/')));
  const files: Record<string, string> = {};
  const tree = await gitOutput(root, ['ls-tree', '-r', 'HEAD']);
  for (const line of tree.split('\n')) {
    // format: <mode> blob <sha>\t<path>
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const relPath = line.slice(tab + 1);
    if (!wanted.has(relPath)) continue;
    const sha = line.slice(0, tab).split(/\s+/)[2];
    if (sha) files[relPath] = sha;
  }
  return { files };
}

export interface PinViolation {
  file: string;
  kind: 'modified' | 'deleted';
}

/**
 * Verifies pins inside an experiment worktree:
 *  1. the HEAD tree must contain the pinned blob for every protected path
 *     (catches tampering committed anywhere in the experiment's ancestry), and
 *  2. the working tree must have no uncommitted change to a protected path.
 */
export async function verifyPins(worktreePath: string, pins: PinSet): Promise<PinViolation[]> {
  const violations: PinViolation[] = [];
  const pinned = new Set(Object.keys(pins.files));

  const tree = await gitOutput(worktreePath, ['ls-tree', '-r', 'HEAD']);
  const inHead = new Map<string, string>();
  for (const line of tree.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const sha = line.slice(0, tab).split(/\s+/)[2];
    if (sha) inHead.set(line.slice(tab + 1), sha);
  }
  for (const [file, sha] of Object.entries(pins.files)) {
    const actual = inHead.get(file);
    if (!actual) violations.push({ file, kind: 'deleted' });
    else if (actual !== sha) violations.push({ file, kind: 'modified' });
  }

  const status = await gitOutputRaw(worktreePath, ['status', '--porcelain']);
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    const rel = parseStatusPath(line);
    if (!rel) continue;
    if (pinned.has(rel) && !violations.some((v) => v.file === rel)) {
      violations.push({ file: rel, kind: line.slice(0, 2).includes('D') ? 'deleted' : 'modified' });
    }
  }
  return violations;
}

function parseStatusPath(line: string): string | null {
  // porcelain v1: XY <path> (or "XY <old> -> <new>" for renames)
  let rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  if (arrow !== -1) rest = rest.slice(arrow + 4);
  rest = rest.trim();
  if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
  return rest ? rest.replaceAll('\\', '/') : null;
}

export function pinsDisplayPath(file: string): string {
  return path.normalize(file);
}
