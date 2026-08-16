/**
 * `paxcli/hosts` — everything needed to build or embed a host adapter:
 * the 4-method HostAdapter contract, the built-in adapters, auto-detection,
 * and the shared JSONL streaming machinery.
 */
export { ClaudeCodeAdapter, createHostAdapter } from './claude-code/adapter.js';
export { CodexAdapter } from './codex/adapter.js';
export {
  HOST_LABELS,
  chooseTaskHost,
  detectHosts,
  ensureHostAvailable,
  type DetectedHost,
  type HostChoice,
} from './detect.js';
export { MockHostAdapter, loadMockPatches, type MockPatch } from './mock/adapter.js';
export {
  buildAgentRunResult,
  feedJsonlChunk,
  streamJsonlAgent,
  type StreamedRun,
} from './stream.js';
export type { AgentRunResult, AgentSpawnOpts, HostAdapter, HostDetection } from './types.js';
