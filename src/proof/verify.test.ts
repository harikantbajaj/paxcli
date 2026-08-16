import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { beforeEach, describe, expect, it } from 'vitest';
import { Worktree } from '../worktree/local.js';
import { capturePins } from './pins.js';
import { screenCandidate } from './verify.js';

/**
 * The shared screening pipeline both engines run the moment an agent stops:
 * pins → change check → detectors. Exercised against a real git repo.
 */

let root: string;
let wt: Worktree;

const git = (args: string[]) => execa('git', args, { cwd: root });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-screen-'));
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'src.js'), 'export const x = 1;\n');
  await writeFile(path.join(root, 'protected.test.js'), 'test("t", () => {});\n');
  await git(['add', '-A']);
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c', '--no-verify']);
  // The screening target IS the repo here — Worktree only needs a checkout path.
  wt = new Worktree('t', root, 'main', root);
});

describe('screenCandidate', () => {
  it('reports no-changes for an untouched tree', async () => {
    const pins = await capturePins(root, ['protected.test.js']);
    const screen = await screenCandidate({ worktree: wt, pins, allowDependencyChanges: false });
    expect(screen.verdict).toBe('no-changes');
  });

  it('rejects a protected-file edit before anything else', async () => {
    const pins = await capturePins(root, ['protected.test.js']);
    await writeFile(path.join(root, 'protected.test.js'), '// gutted\n');
    await writeFile(path.join(root, 'src.js'), 'export const x = 2;\n');
    const screen = await screenCandidate({ worktree: wt, pins, allowDependencyChanges: false });
    expect(screen.verdict).toBe('pin-violation');
    if (screen.verdict === 'pin-violation') {
      expect(screen.files).toContain('protected.test.js');
    }
  });

  it('accepts a clean change and lists the changed files', async () => {
    const pins = await capturePins(root, ['protected.test.js']);
    await writeFile(path.join(root, 'src.js'), 'export const x = 2;\n');
    const screen = await screenCandidate({ worktree: wt, pins, allowDependencyChanges: false });
    expect(screen.verdict).toBe('clean');
    if (screen.verdict === 'clean') {
      expect(screen.changedFiles).toEqual(['src.js']);
      expect(screen.suspicions).toEqual([]);
    }
  });

  it('flags violation-severity reward hacks found in the diff', async () => {
    const pins = await capturePins(root, ['protected.test.js']);
    // A skipped test in the diff is a violation-severity detector hit.
    await writeFile(path.join(root, 'src.js'), 'it.skip("was a test", () => {});\n');
    const screen = await screenCandidate({ worktree: wt, pins, allowDependencyChanges: false });
    expect(screen.verdict).toBe('detector-violation');
  });
});
