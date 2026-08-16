import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runWithheldChecks, withheldDir } from './withheld.js';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(tmpdir(), 'paxcli-withheld-'));
});

describe('runWithheldChecks', () => {
  it('reports unconfigured (and passing) when no command is set', async () => {
    const result = await runWithheldChecks(repoRoot, repoRoot, undefined, 5000);
    expect(result).toMatchObject({ configured: false, pass: true, category: null });
  });

  it('fails with a clear category when the withheld directory is missing', async () => {
    const result = await runWithheldChecks(repoRoot, repoRoot, 'node -e "process.exit(0)"', 5000);
    expect(result).toMatchObject({
      configured: true,
      pass: false,
      category: 'withheld-cases-missing',
    });
  });

  it('passes on exit 0 and exposes TARGET_DIR/WITHHELD_DIR to the command', async () => {
    await mkdir(withheldDir(repoRoot), { recursive: true });
    const cmd =
      'node -e "process.exit(process.env.TARGET_DIR && process.env.WITHHELD_DIR ? 0 : 1)"';
    const result = await runWithheldChecks(repoRoot, path.join(repoRoot, 'wt'), cmd, 10_000);
    expect(result.configured).toBe(true);
    expect(result.pass).toBe(true);
  });

  it('shares only the coarse CATEGORY on failure — never inputs or outputs', async () => {
    await mkdir(withheldDir(repoRoot), { recursive: true });
    const cmd =
      "node -e \"console.log('CATEGORY: order-sensitivity'); console.log('secret expected output'); process.exit(1)\"";
    const result = await runWithheldChecks(repoRoot, repoRoot, cmd, 10_000);
    expect(result.pass).toBe(false);
    expect(result.category).toBe('order-sensitivity');
  });

  it('falls back to behavior-mismatch when no category line is printed', async () => {
    await mkdir(withheldDir(repoRoot), { recursive: true });
    const result = await runWithheldChecks(repoRoot, repoRoot, 'node -e "process.exit(1)"', 10_000);
    expect(result.category).toBe('behavior-mismatch');
  });
});
