import { execa } from 'execa';
import { buildAgentRunResult, streamJsonlAgent } from '../stream.js';
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
    // "-" makes codex exec read the prompt from stdin — multi-line prompts
    // cannot survive as CLI arguments through shell:true on Windows.
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
    args.push('-');

    let finalText = '';
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;

    const run = await streamJsonlAgent({
      command: 'codex',
      args,
      opts,
      onEvent: (raw) => {
        const event = raw as CodexEvent;
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
      },
    });

    return buildAgentRunResult({
      run,
      opts,
      label: 'Codex',
      finalText,
      costUsd: null,
      tokensIn,
      tokensOut,
    });
  }
}
