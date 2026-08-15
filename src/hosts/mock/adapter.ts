import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRunResult, AgentSpawnOpts, HostAdapter, HostDetection } from '../types.js';

/**
 * MockHostAdapter: a scripted "agent" that applies canned patches in order.
 * It makes the entire engine testable without API keys, and it powers
 * `paxcli demo` — including the patch that tries to cheat the benchmark so
 * users can watch the Proof Layer reject it.
 */

export interface MockPatch {
  hypothesis: string;
  /** repo-relative file -> full new content */
  files: Record<string, string>;
}

export class MockHostAdapter implements HostAdapter {
  readonly id = 'mock';
  private cursor = 0;

  constructor(private readonly patches: MockPatch[]) {}

  async detect(): Promise<HostDetection> {
    return { found: true, version: 'mock' };
  }

  async spawnAgent(opts: AgentSpawnOpts): Promise<AgentRunResult> {
    const started = Date.now();
    const patch = this.patches[this.cursor % Math.max(this.patches.length, 1)];
    this.cursor += 1;
    if (!patch) {
      return {
        ok: false,
        exitReason: 'error',
        finalText: 'Mock adapter has no patches left',
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - started,
      };
    }
    opts.onStatus?.(`Testing hypothesis: ${patch.hypothesis}`);
    for (const [rel, content] of Object.entries(patch.files)) {
      const target = path.join(opts.cwd, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
    await appendFile(
      opts.logPath,
      `${JSON.stringify({ type: 'mock_patch_applied', hypothesis: patch.hypothesis, files: Object.keys(patch.files) })}\n`,
      'utf8',
    );
    return {
      ok: true,
      exitReason: 'completed',
      finalText: `HYPOTHESIS: ${patch.hypothesis}`,
      costUsd: 0.01,
      tokensIn: 1000,
      tokensOut: 500,
      durationMs: Date.now() - started,
    };
  }
}

/** Loads a patch script from a JSON file (used by tests and the demo). */
export async function loadMockPatches(file: string): Promise<MockPatch[]> {
  return JSON.parse(await readFile(file, 'utf8')) as MockPatch[];
}
