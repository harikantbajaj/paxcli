import { appendFile } from 'node:fs/promises';
import { execa } from 'execa';
import type { AgentRunResult, AgentSpawnOpts, HostAdapter, HostDetection } from '../types.js';

/**
 * Claude Code adapter: spawns `claude -p` headlessly inside the experiment
 * worktree and parses its stream-json NDJSON output. The terminal `result`
 * event reports total cost and token usage directly.
 *
 * Tools are restricted to file editing plus the commands the policy allows;
 * `--permission-mode acceptEdits` keeps the headless run from hanging on
 * permission prompts.
 */

interface StreamEvent {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: { content?: Array<{ type: string; text?: string; name?: string }> };
}

export class ClaudeCodeAdapter implements HostAdapter {
  readonly id = 'claude-code';

  async detect(): Promise<HostDetection> {
    try {
      const { stdout } = await execa('claude', ['--version'], { timeout: 15_000, shell: true });
      return { found: true, version: String(stdout).trim() };
    } catch {
      return {
        found: false,
        problem:
          'Claude Code CLI not found. Install it with `npm install -g @anthropic-ai/claude-code` and sign in once with `claude`.',
      };
    }
  }

  async spawnAgent(opts: AgentSpawnOpts): Promise<AgentRunResult> {
    const started = Date.now();
    const args = [
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Edit,Write,Read,Bash,Glob,Grep',
    ];
    if (opts.model) args.push('--model', opts.model);

    const child = execa('claude', args, {
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
    let costUsd: number | null = null;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let sawResult = false;
    let isError = false;
    let carry = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      carry += chunk.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        void appendFile(opts.logPath, `${trimmed}\n`, 'utf8').catch(() => {});
        let event: StreamEvent;
        try {
          event = JSON.parse(trimmed) as StreamEvent;
        } catch {
          continue;
        }
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'tool_use' && block.name) {
              opts.onStatus?.(`Agent using ${block.name}`);
            }
          }
        }
        if (event.type === 'result') {
          sawResult = true;
          isError = Boolean(event.is_error);
          finalText = event.result ?? '';
          costUsd = event.total_cost_usd ?? null;
          tokensIn = event.usage?.input_tokens ?? null;
          tokensOut = event.usage?.output_tokens ?? null;
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
        costUsd,
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
        costUsd,
        tokensIn,
        tokensOut,
        durationMs,
      };
    }
    if (!sawResult || isError || result.exitCode !== 0) {
      const stderrTail = String(result.stderr ?? '').slice(-500);
      return {
        ok: false,
        exitReason: 'error',
        finalText: finalText || `Claude Code exited ${result.exitCode}. ${stderrTail}`,
        costUsd,
        tokensIn,
        tokensOut,
        durationMs,
      };
    }
    return {
      ok: true,
      exitReason: 'completed',
      finalText,
      costUsd,
      tokensIn,
      tokensOut,
      durationMs,
    };
  }
}

export function createHostAdapter(id: string, mockPatchesFile?: string): Promise<HostAdapter> {
  return (async () => {
    if (id === 'claude-code') return new ClaudeCodeAdapter();
    if (id === 'mock') {
      const { MockHostAdapter, loadMockPatches } = await import('../mock/adapter.js');
      const patches = mockPatchesFile ? await loadMockPatches(mockPatchesFile) : [];
      return new MockHostAdapter(patches);
    }
    throw new Error(`Unknown host adapter: ${id}`);
  })();
}
