import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { beforeEach, describe, expect, it } from 'vitest';
import { capturePins, verifyPins } from './pins.js';

/**
 * Adversarial suite: every classic reward-hack that touches a protected file
 * must be caught, whether the tampering is uncommitted or committed.
 */

let root: string;
let wt: string;

const git = (args: string[], cwd = root) => execa('git', args, { cwd });
const commit = (cwd = root) =>
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c', '--no-verify'], cwd);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-pins-'));
  await writeFile(path.join(root, 'bench.js'), 'benchmark code\n');
  await writeFile(path.join(root, 'test.js'), 'test code\n');
  await writeFile(path.join(root, 'lib.js'), 'library code\n');
  await git(['init', '-b', 'main']);
  await git(['add', '-A']);
  await commit();
  wt = path.join(root, '.paxcli', 'worktrees', 'x1');
  await git(['worktree', 'add', '-b', 'paxcli/exp/x1', wt, 'HEAD']);
});

describe('integrity pins', () => {
  it('captures blob hashes for protected globs', async () => {
    const pins = await capturePins(root, ['bench.js', 'test.js']);
    expect(Object.keys(pins.files).sort()).toEqual(['bench.js', 'test.js']);
  });

  it('passes when protected files are untouched (even with other edits)', async () => {
    const pins = await capturePins(root, ['bench.js', 'test.js']);
    await writeFile(path.join(wt, 'lib.js'), 'improved library\n');
    expect(await verifyPins(wt, pins)).toEqual([]);
  });

  it('catches an uncommitted edit to a protected file', async () => {
    const pins = await capturePins(root, ['bench.js']);
    await writeFile(path.join(wt, 'bench.js'), 'measure something easier\n');
    const violations = await verifyPins(wt, pins);
    expect(violations).toEqual([{ file: 'bench.js', kind: 'modified' }]);
  });

  it('catches a committed edit to a protected file (ancestry tampering)', async () => {
    const pins = await capturePins(root, ['test.js']);
    await writeFile(path.join(wt, 'test.js'), 'assert.ok(true) // gutted\n');
    await git(['add', '-A'], wt);
    await commit(wt);
    const violations = await verifyPins(wt, pins);
    expect(violations).toEqual([{ file: 'test.js', kind: 'modified' }]);
  });

  it('catches deletion of a protected file', async () => {
    const pins = await capturePins(root, ['test.js']);
    const { rm } = await import('node:fs/promises');
    await rm(path.join(wt, 'test.js'));
    const violations = await verifyPins(wt, pins);
    expect(violations.some((v) => v.file === 'test.js')).toBe(true);
  });
});
