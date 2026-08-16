/**
 * Public API of the paxcli engine — everything the CLI composes is exported
 * here so community host adapters, recipes, and tooling can build on the same
 * primitives.
 */
export { applyTaskResult, type ApplyResult } from './apply/patch.js';
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
export {
  startFleetDashboard,
  type FleetDashboardHandle,
  type FleetDashboardOptions,
} from './control-plane/server.js';
export { FleetClient } from './control-plane/client.js';
export {
  MemoryControlPlane,
  type ActivityKind,
  type AgentActivity,
  type AgentRun,
  type ApprovalState,
  type ConnectedRepository,
  type ControlPlaneEvent,
  type ControlPlaneSnapshot,
  type RepositorySettings,
  type RunStatus,
} from './control-plane/store.js';
export { discover, type DiscoveryFinding } from './discovery/scan.js';
export {
  TASK_PROTECTED_DEFAULTS,
  describeDiscovery,
  discoverRepo,
  type DetectedCommand,
  type RepoDiscovery,
} from './discovery/repo.js';
export {
  reproduceWinner,
  runOptimize,
  type RunOptions,
  type RunOutcome,
} from './engine/run-loop.js';
export {
  buildExperimentPrompt,
  buildResearchPrompt,
  extractHypothesis,
} from './engine/prompt.js';
export { appendSteering, readSteering } from './engine/steering.js';
export {
  cleanupTaskWorktree,
  runTask,
  type TaskCheckResult,
  type TaskOutcome,
  type TaskRunOptions,
  type TaskStatus,
} from './engine/task-loop.js';
export {
  buildInquiryPrompt,
  buildRepairPrompt,
  buildTaskPrompt,
  extractSummary,
} from './engine/task-prompt.js';
export { selectParent } from './frontier/select.js';
export { runGates } from './gates/engine.js';
export { ClaudeCodeAdapter, createHostAdapter } from './hosts/claude-code/adapter.js';
export { CodexAdapter } from './hosts/codex/adapter.js';
export {
  chooseTaskHost,
  detectHosts,
  type DetectedHost,
  type HostChoice,
} from './hosts/detect.js';
export {
  buildSnapshot,
  deleteInternalRefs,
  ensureRepo,
  listInternalRefs,
  writeResultRef,
  type Snapshot,
} from './snapshot/build.js';
export { MockHostAdapter, loadMockPatches, type MockPatch } from './hosts/mock/adapter.js';
export type { AgentRunResult, AgentSpawnOpts, HostAdapter } from './hosts/types.js';
export { buildAgentEnv, permissionSummary } from './policy/env.js';
export { runDetectors, parseDiff, type DetectorFinding } from './proof/detectors.js';
export { capturePins, verifyPins, type PinSet } from './proof/pins.js';
export { containsSecrets, redactText, redactValue } from './proof/redact.js';
export { screenCandidate, type ScreenResult } from './proof/verify.js';
export { runWithheldChecks, withheldDir } from './proof/withheld.js';
export {
  RECEIPT_VERSION,
  buildReceipt,
  parseReceipt,
  receiptSchema,
  writeReceipt,
  type Receipt,
} from './proof/receipt.js';
export { buildRunReport, writeRunReport } from './report/markdown.js';
export { appendJournalRound } from './insights/journal.js';
export {
  appendLedgerEntry,
  computeStats,
  parseLedger,
  renderLedger,
  verifyLedger,
  LEDGER_DEFAULT_PATH,
  type AppendResult,
  type LedgerStats,
  type ParsedLedger,
  type VerifyResult,
} from './ledger/file.js';
export { entryTitle, renderEntryMarkdown } from './ledger/render.js';
export {
  entryFromReceipt,
  entryFromTaskOutcome,
  entryKey,
  ledgerEntrySchema,
  optimizationEntrySchema,
  taskEntrySchema,
  type LedgerEntry,
  type OptimizationEntry,
  type TaskEntry,
} from './ledger/schema.js';
export { buildCardRows, renderVerificationCard, type CardRow } from './report/card.js';
export {
  EventStore,
  EngineLock,
  appendTerminalEvent,
  paxcliDir,
  reduceEvents,
  runDir,
} from './tree/store.js';
export {
  BenchmarkUnstableError,
  ConfigError,
  GitStateError,
  HostUnavailableError,
  NotFoundError,
  PaxcliError,
  type PaxcliErrorCode,
} from './util/errors.js';
// Named, curated — the event union and envelope are exported for tooling but
// their internals may evolve behind EVENT_SCHEMA_VERSION migrations.
export {
  EVENT_SCHEMA_VERSION,
  agentRunSummary,
  betterThan,
  improvementPct,
  newExperimentNode,
  type AgentRunSummary,
  type EngineEvent,
  type EventEnvelope,
  type ExperimentNode,
  type GateResult,
  type Insight,
  type MetricDirection,
  type NodeStatus,
  type RunSummary,
  type Score,
  type VerificationGrade,
} from './tree/types.js';
export {
  Worktree,
  WorktreeBackend,
  snapshotRepo,
  stageAllExcludingDeps,
} from './worktree/local.js';
