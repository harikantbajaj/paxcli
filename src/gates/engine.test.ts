import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GateConfig } from '../config/schema.js';
import { runGates } from './engine.js';

let cwd: string;

const gate = (over: Partial<GateConfig> & Pick<GateConfig, 'id' | 'name' | 'cmd'>): GateConfig => ({
  timeoutMs: 60_000,
  kind: 'custom',
  ...over,
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'paxcli-gates-'));
});

describe('runGates', () => {
  it('passes on exit 0 and records duration and output', async () => {
    const results = await runGates(
      [gate({ id: 'ok', name: 'ok gate', cmd: 'node -e "console.log(\'fine\')"' })],
      cwd,
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.exitCode).toBe(0);
    expect(results[0]?.stdoutTail).toContain('fine');
  });

  it('stops at the first failure — later gates cannot rescue the experiment', async () => {
    const results = await runGates(
      [
        gate({ id: 'bad', name: 'failing gate', cmd: 'node -e "process.exit(3)"' }),
        gate({ id: 'never', name: 'never runs', cmd: 'node -e "process.exit(0)"' }),
      ],
      cwd,
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.exitCode).toBe(3);
  });

  it('runs inside a gate cwd relative to the worktree', async () => {
    await mkdir(path.join(cwd, 'sub'));
    const results = await runGates(
      [
        gate({
          id: 'sub',
          name: 'subdir gate',
          cmd: 'node -e "console.log(process.cwd())"',
          cwd: 'sub',
        }),
      ],
      cwd,
      {},
    );
    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.stdoutTail).toContain('sub');
  });

  it('rejects a gate cwd that escapes the worktree without running it', async () => {
    const results = await runGates(
      [gate({ id: 'esc', name: 'escape', cmd: 'node -e "process.exit(0)"', cwd: '../outside' })],
      cwd,
      {},
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.stdoutTail).toContain('outside the worktree');
  });
});
