/**
 * HostAdapter: the contract between Paxcli's engine and any AI coding agent
 * CLI (Claude Code today; Codex and others later). The host edits code inside
 * an isolated worktree; Paxcli evaluates the result deterministically.
 */

export interface AgentSpawnOpts {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  model?: string;
  /** Filtered environment — agents never inherit the user's full env. */
  env: Record<string, string>;
  /** Raw host output is teed here (one file per agent run). */
  logPath: string;
  onStatus?: (msg: string) => void;
}

export interface AgentRunResult {
  ok: boolean;
  exitReason: 'completed' | 'timeout' | 'cancelled' | 'error' | 'budget';
  finalText: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
}

export interface HostDetection {
  found: boolean;
  version?: string;
  problem?: string;
}

export interface HostAdapter {
  readonly id: string;
  detect(): Promise<HostDetection>;
  spawnAgent(opts: AgentSpawnOpts): Promise<AgentRunResult>;
}
