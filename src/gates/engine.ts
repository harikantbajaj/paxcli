import path from 'node:path';
import { execa } from 'execa';
import type { GateConfig } from '../config/schema.js';
import type { GateResult } from '../tree/types.js';

/**
 * Command gates: pass/fail shell commands run inside the experiment worktree.
 * Any failure rejects the experiment regardless of how good the score looks —
 * a fast wrong answer is still wrong.
 */
export async function runGates(
  gates: GateConfig[],
  cwd: string,
  env: Record<string, string>,
  onStatus?: (msg: string) => void,
): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    onStatus?.(`Running gate: ${gate.name}`);
    const started = Date.now();
    // Gates run INSIDE the worktree — a cwd that resolves outside it would
    // silently run checks against the user's real tree instead of the
    // candidate under evaluation.
    const gateCwd = gate.cwd ? path.resolve(cwd, gate.cwd) : cwd;
    const rel = path.relative(cwd, gateCwd);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      results.push({
        gateId: gate.id,
        name: gate.name,
        pass: false,
        exitCode: null,
        durationMs: 0,
        stdoutTail: `Gate cwd "${gate.cwd}" resolves outside the worktree — gates must run inside the experiment checkout.`,
      });
      break;
    }
    try {
      const { exitCode, stdout, stderr } = await execa(gate.cmd, {
        cwd: gateCwd,
        env,
        shell: true,
        timeout: gate.timeoutMs,
        reject: false,
        all: true,
      });
      const output = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
      results.push({
        gateId: gate.id,
        name: gate.name,
        pass: exitCode === 0,
        exitCode: exitCode ?? null,
        durationMs: Date.now() - started,
        stdoutTail: output.slice(-2000),
      });
    } catch (err) {
      results.push({
        gateId: gate.id,
        name: gate.name,
        pass: false,
        exitCode: null,
        durationMs: Date.now() - started,
        stdoutTail: `Gate crashed or timed out: ${(err as Error).message}`.slice(-2000),
      });
    }
    const last = results[results.length - 1] as GateResult;
    if (!last.pass) break; // later gates can't rescue a failed experiment
  }
  return results;
}
