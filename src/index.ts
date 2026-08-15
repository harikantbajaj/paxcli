/**
 * Public API of the paxcli engine — everything the CLI composes is exported
 * here so community host adapters, recipes, and tooling can build on the same
 * primitives.
 */
export { BenchmarkHarness } from './bench/harness.js';
export * as stats from './bench/stats.js';
export {
  paxcliConfigSchema,
  configHash,
  loadConfig,
  parseConfig,
  type PaxcliConfig,
  type BenchmarkConfig,
  type GateConfig,
  type PolicyConfig,
} from './config/schema.js';
export { readBaseline, writeBaseline, judgeRegression } from './ci/baseline.js';
export { startDashboard } from './dashboard/server.js';
export { discover, type DiscoveryFinding } from './discovery/scan.js';
export {
  reproduceWinner,
  runOptimize,
  type RunOptions,
  type RunOutcome,
} from './engine/run-loop.js';
export { appendSteering, readSteering } from './engine/steering.js';
export { selectParent } from './frontier/select.js';
export { runGates } from './gates/engine.js';
export { ClaudeCodeAdapter, createHostAdapter } from './hosts/claude-code/adapter.js';
export { CodexAdapter } from './hosts/codex/adapter.js';
export { MockHostAdapter, loadMockPatches, type MockPatch } from './hosts/mock/adapter.js';
export type { AgentRunResult, AgentSpawnOpts, HostAdapter } from './hosts/types.js';
export { buildAgentEnv, permissionSummary } from './policy/env.js';
export { runDetectors, parseDiff, type DetectorFinding } from './proof/detectors.js';
export { capturePins, verifyPins, type PinSet } from './proof/pins.js';
export { containsSecrets, redactText, redactValue } from './proof/redact.js';
export { runWithheldChecks, withheldDir } from './proof/withheld.js';
export { buildReceipt, writeReceipt, type Receipt } from './proof/receipt.js';
export { renderVerificationCard } from './report/card.js';
export { EventStore, EngineLock, reduceEvents } from './tree/store.js';
export * from './tree/types.js';
export { WorktreeBackend, snapshotRepo } from './worktree/local.js';
