import { existsSync } from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

/**
 * Withheld evaluator cases: behavior checks whose inputs and expected outputs
 * live under .paxcli/withheld/ in the MAIN repository. That directory is
 * gitignored, so experiment worktrees never contain it and agents never see
 * the cases in their checkout. On failure, only a coarse CATEGORY reaches
 * agents and shared insights — never inputs or expected outputs.
 *
 * Honesty note (docs/trust-boundary.md): a local agent could in principle
 * traverse the filesystem and read the directory; "withheld" means kept out
 * of the loop, not cryptographically hidden. Process-boundary isolation is
 * the hardening path.
 */

export interface WithheldResult {
  configured: boolean;
  pass: boolean;
  /** Coarse failure category (safe to share with agents). */
  category: string | null;
  durationMs: number;
}

export function withheldDir(repoRoot: string): string {
  return path.join(repoRoot, '.paxcli', 'withheld');
}

export async function runWithheldChecks(
  repoRoot: string,
  worktreePath: string,
  cmd: string | undefined,
  timeoutMs: number,
): Promise<WithheldResult> {
  if (!cmd) return { configured: false, pass: true, category: null, durationMs: 0 };
  const dir = withheldDir(repoRoot);
  if (!existsSync(dir)) {
    return { configured: true, pass: false, category: 'withheld-cases-missing', durationMs: 0 };
  }
  const started = Date.now();
  const { exitCode, stdout, stderr } = await execa(cmd, {
    cwd: repoRoot,
    env: { ...process.env, TARGET_DIR: worktreePath, WITHHELD_DIR: dir },
    shell: true,
    timeout: timeoutMs,
    reject: false,
    all: true,
  });
  const durationMs = Date.now() - started;
  if (exitCode === 0) return { configured: true, pass: true, category: null, durationMs };
  const output = `${stdout ?? ''}\n${stderr ?? ''}`;
  const category = output.match(/CATEGORY:\s*([\w-]+)/)?.[1] ?? 'behavior-mismatch';
  return { configured: true, pass: false, category, durationMs };
}
