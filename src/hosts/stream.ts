import { appendFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { AgentRunResult, AgentSpawnOpts } from './types.js';

/**
 * Shared machinery for JSONL-streaming host CLIs (Claude Code, Codex): one
 * process harness, one NDJSON line splitter, one result builder. Adapters
 * keep only what genuinely differs — argv and their event vocabulary.
 */

/** Pure NDJSON splitter with partial-line carry — a chunk boundary can land
 * mid-line, so the trailing fragment rides along to the next chunk. */
export function feedJsonlChunk(carry: string, chunk: string): { lines: string[]; carry: string } {
  const parts = (carry + chunk).split('\n');
  const nextCarry = parts.pop() ?? '';
  return { lines: parts.map((l) => l.trim()).filter((l) => l.length > 0), carry: nextCarry };
}

export interface StreamedRun {
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
  durationMs: number;
}

/**
 * Spawns the host CLI, mirrors every stdout line into the trace log, and
 * hands each parsed JSON event to the adapter. The prompt travels via stdin:
 * passing multi-line text as a CLI argument through shell:true gets mangled
 * by cmd.exe on Windows.
 */
export async function streamJsonlAgent(params: {
  command: string;
  args: string[];
  opts: AgentSpawnOpts;
  onEvent: (event: unknown) => void;
}): Promise<StreamedRun> {
  const { opts } = params;
  const started = Date.now();
  const child = execa(params.command, params.args, {
    cwd: opts.cwd,
    env: opts.env,
    extendEnv: false,
    shell: true,
    timeout: opts.timeoutMs,
    cancelSignal: opts.signal,
    forceKillAfterDelay: 5000,
    reject: false,
    buffer: false,
    input: opts.prompt,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let carry = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const fed = feedJsonlChunk(carry, chunk.toString('utf8'));
    carry = fed.carry;
    for (const line of fed.lines) {
      void appendFile(opts.logPath, `${line}\n`, 'utf8').catch(() => {});
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // non-JSON noise on stdout
      }
      params.onEvent(event);
    }
  });

  const result = await child;
  return {
    exitCode: result.exitCode ?? null,
    timedOut: Boolean(result.timedOut),
    stderr: String(result.stderr ?? ''),
    durationMs: Date.now() - started,
  };
}

/**
 * Uniform outcome mapping: cancelled beats timeout beats error beats success.
 * Failures always point at the JSONL trace so the user can see what the
 * agent actually did — a 500-char stderr tail alone buries the evidence.
 */
export function buildAgentRunResult(params: {
  run: StreamedRun;
  opts: AgentSpawnOpts;
  /** Human label for fallback error text, e.g. "Claude Code". */
  label: string;
  finalText: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Adapter-specific failure signal on top of the exit code. */
  failed?: boolean;
}): AgentRunResult {
  const { run, opts } = params;
  const base = {
    finalText: params.finalText,
    costUsd: params.costUsd,
    tokensIn: params.tokensIn,
    tokensOut: params.tokensOut,
    durationMs: run.durationMs,
  };
  if (opts.signal.aborted) return { ok: false, exitReason: 'cancelled', ...base };
  if (run.timedOut) return { ok: false, exitReason: 'timeout', ...base };
  if (params.failed || run.exitCode !== 0) {
    const stderrTail = run.stderr.slice(-500);
    const headline = params.finalText || `${params.label} exited ${run.exitCode}. ${stderrTail}`;
    return {
      ok: false,
      exitReason: 'error',
      ...base,
      finalText: `${headline}\n(agent trace: ${opts.logPath})`,
    };
  }
  return { ok: true, exitReason: 'completed', ...base };
}
