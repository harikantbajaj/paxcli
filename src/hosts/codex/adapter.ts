import { appendFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { AgentRunResult, AgentSpawnOpts, HostAdapter, HostDetection } from '../types.js';

/**
 * Codex CLI adapter: spawns `codex exec --json` headlessly inside the
 * experiment worktree and parses its JSONL event stream. Codex reports token
 * usage but not USD cost, so costUsd is null and budget tracking falls back
 * to token counts (documented in the run header).
 */

interface CodexEvent {
  type: string;
  item?: { type?: string; text?: string; command?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: string;
}

export class CodexAdapter implements HostAdapter {
  readonly id = 'codex';

  async detect(): Promise<HostDetection> {
    try {
      const { stdout } = await execa('codex', ['--version'], { timeout: 15_000, shell: true });
      return { found: true, version: String(stdout).trim() };
    } catch {
      return {
        found: false,
        problem:
          'Codex CLI not found. Install it with `npm install -g @openai/codex` and sign in once with `codex`.',
      };
    }
  }

  async spawnAgent(opts: AgentSpawnOpts): Promise<AgentRunResult> {
    const started = Date.now();
    const args = [
      'exec',
      '--json',
      '--cd',
      opts.cwd,
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
    ];
    if (opts.model) args.push('--model', opts.model);
    args.push(opts.prompt);

    const child = execa('codex', args, {
      cwd: opts.cwd,
      env: opts.env,
      extendEnv: false,
      shell: true,
      timeout: opts.timeoutMs,
      cancelSignal: opts.signal,
      forceKillAfterDelay: 5000,
      reject: false,
      buffer: false,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let finalText = '';
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let carry = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      carry += chunk.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        void appendFile(opts.logPath, `${trimmed}\n`, 'utf8').catch(() => {});
        let event: CodexEvent;
        try {
          event = JSON.parse(trimmed) as CodexEvent;
        } catch {
          continue;
        }
        if (event.item?.type === 'agent_message' && event.item.text) {
          finalText = event.item.text;
        }
        if (event.item?.type === 'command_execution' && event.item.command) {
          opts.onStatus?.(`Agent running: ${event.item.command.slice(0, 80)}`);
        }
        if (event.usage) {
          tokensIn = event.usage.input_tokens ?? tokensIn;
          tokensOut = event.usage.output_tokens ?? tokensOut;
        }
      }
    });

    const result = await child;
    const durationMs = Date.now() - started;

    if (opts.signal.aborted) {
      return {
        ok: false,
        exitReason: 'cancelled',
        finalText,
        costUsd: null,
        tokensIn,
        tokensOut,
        durationMs,
      };
    }
    if (result.timedOut) {
      return {
        ok: false,
        exitReason: 'timeout',
        finalText,
        costUsd: null,
        tokensIn,
        tokensOut,
        durationMs,
      };
    }
    if (result.exitCode !== 0) {
      const stderrTail = String(result.stderr ?? '').slice(-500);
      return {
        ok: false,
        exitReason: 'error',
        finalText: finalText || `Codex exited ${result.exitCode}. ${stderrTail}`,
        costUsd: null,
        tokensIn,
        tokensOut,
        durationMs,
      };
    }
    return {
      ok: true,
      exitReason: 'completed',
      finalText,
      costUsd: null,
      tokensIn,
      tokensOut,
      durationMs,
    };
  }
}
