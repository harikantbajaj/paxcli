# Changelog

All notable changes to paxcli. Versions follow [SemVer](https://semver.org).

## 0.6.0 — 2026-08-16

### Paxcli Fleet

- New zero-repository-footprint, multi-repository dashboard with a live organization
  overview of connected repositories, active agents, work stages, costs, approvals, and
  verified outcomes.
- New memory-only control plane for repository settings, agent runs, redacted activity,
  outputs, and human approval decisions. Starting Fleet creates no config, receipt, log,
  JSON file, hidden directory, branch, or commit in connected repositories.
- New authenticated HTTP ingestion API and server-sent event stream. All agent-facing
  strings are secret-redacted before retention; the loopback server uses token auth,
  strict Host validation, request-size limits, no-store responses, and a restrictive CSP.
- Optimization runs can stream live plans, hypotheses, benchmark stages, checks,
  decisions, cost, and final results to Fleet through the environment-only
  `PAXCLI_FLEET_URL` connection. No dashboard connection file is written.
- Fleet intentionally shows concise, auditable agent rationale and evidence rather than
  private model chain-of-thought.

### Product and onboarding

- Performance optimization is now the primary CLI and README wedge: give Paxcli a slow
  endpoint and receive a verified result to review.
- First-run setup discovers existing test, lint, typecheck, and build commands and adds
  them to the generated benchmark configuration.
- Successful runs lead with the change, measured outcome, verification evidence, agent,
  and cost before showing the detailed Verification Card.
- `paxcli doctor --help` now consistently advertises both Claude Code and Codex.

### Library and tests

- Exported `MemoryControlPlane`, `FleetClient`, and `startFleetDashboard` for hosted
  services, connectors, and self-hosted runners.
- Added control-plane store, server-security, and end-to-end Fleet streaming tests.
- 128 tests across 25 files pass on the release build.

## 0.5.0 — 2026-08-16

### One verification pipeline

Both engines — verified optimization and Simple Mode tasks — now run the same shared
screening the moment an agent stops: `screenCandidate` (integrity pins → change check →
static reward-hack detectors) in `src/proof/verify.ts`. The seven previously duplicated
verification blocks are gone; each loop keeps only its own policy (benchmark/threshold
vs. checks/repair). Node construction, agent-run summaries, host preflight, and terminal
events are shared too. Behavior-preserving: all messages and decisions unchanged.

### Validated, migratable evidence formats

- Receipts are validated with a zod schema on every read (`parseReceipt`), with a
  version-migration registry — bumping `receiptVersion` now requires a migration instead
  of silently breaking old runs. Same for event-log envelopes in `EventStore.readAll`.
- New public schema: `schema/paxcli.receipt.schema.json` (alongside the config and
  ledger-entry schemas) — the receipt is now a stable, published format.

### Host adapters

- Claude Code and Codex adapters share one JSONL streaming harness
  (`streamJsonlAgent` + `buildAgentRunResult`); each adapter is now just argv + its
  event vocabulary.
- Agent failures now include the path to the full JSONL trace instead of only a
  500-character stderr tail.

### Library surface

- New subpath exports: `paxcli/hosts` (adapter toolkit) and `paxcli/proof` (the Proof
  Layer as a library).
- The package root no longer wildcard-exports internal event types; the surface is
  named and curated, and both prompt modules are exported symmetrically.

### CLI internals

- `src/cli/index.ts` split into per-group command modules (`run`, `benchmark`, `ci`,
  `config`, `ledger`) with shared helpers (`resolveRun`, `resolveAcceptedNode`,
  `withMeasurementWorktree`). Measurement worktrees now use collision-safe ids.

### Tests

- 122 tests across 22 files (0.3.1 had 63): new suites for the screening pipeline,
  JSONL streaming, benchmark output parsing, withheld checks, env policy, gates,
  Verification Card, receipts, and the Proof Ledger. `npm run test:coverage` reports
  V8 coverage (no threshold gate yet).

## 0.4.0 — 2026-08-16

### The Proof Ledger

Paxcli now leaves proof behind in your repository. Applying a result records it in a
committable **`PROOF.md`** at the repo root — an append-only ledger where every entry is a
human-readable verification card backed by an embedded machine-readable receipt
(`ledgerEntryVersion: 1`, redacted, zod-validated).

- `paxcli apply` and Simple Mode (`npx paxcli "<task>"`) append an entry after a
  successful apply. Writes are unstaged and best-effort — never required for a run to
  succeed. Opt out with `--no-ledger` or `"ledger": { "enabled": false }` in
  `paxcli.config.json` (new optional `ledger` config block; existing configs stay valid).
- New commands: `paxcli ledger show`, `paxcli ledger verify` (re-checks the file against
  its own embedded receipts; exit 1 on tampering or stats drift), and
  `paxcli ledger badge` (shields.io README badge from the ledger stats).
- Honest labels are structural: optimization entries carry the verified vocabulary
  (Measured / Validated / Equivalent / Reproduced); task entries can only say
  "checks passed" or "applied — not verified by paxcli". The badge uses the verified
  vocabulary only when a benchmark-backed optimization is on record.
- Appends are idempotent (keyed by run/experiment id) and the whole file is regenerated
  from its parsed entries, so the stats header can never drift silently.
- This repository's own ledger starts with paxcli's self-optimization result
  (stats pipeline −84.8%, grade Reproduced).

### Fixed

- Fresh-reproduction evidence is no longer lost on replay: `winner_reproduced` events now
  reduce into the run summary (with an exhaustiveness guard so future event types cannot
  silently no-op), and `paxcli status` shows the reproduction verdict.
- The optimize engine now excludes dependency directories (`node_modules`, `.venv`,
  `__pycache__`) from staging, matching task mode — in repos without a `.gitignore`,
  install artifacts could previously be attributed to the agent.
- Stale engine locks from recycled PIDs (common on Windows) are detected by comparing the
  lock holder's process start time; a fresh process with a recycled PID no longer blocks
  the run forever. A failure during run-dir setup no longer leaks the lock.
- Gate `cwd` is resolved with proper path semantics and must stay inside the worktree —
  a cwd escaping the experiment checkout now fails the gate instead of silently running
  checks against the wrong tree.
- Receipts record the run id directly instead of deriving it from a filesystem path.
- `--json` failures now emit a structured `{ok:false, code, message, hint}` document on
  stdout (the documented contract); errors carry stable codes and doctor-style repair
  hints (`config`, `host-unavailable`, `git-state`, `not-found`, …).
- `paxcli doctor` failures are guarded like every other command; a missing GitHub CLI is
  reported with install instructions before `paxcli pr` pushes anything.
- Windows benchmark shutdown tries a graceful `taskkill` before the forced sweep,
  mirroring the POSIX SIGTERM → SIGKILL ladder.

### Internal

- `renderVerificationCard` split into a pure `buildCardRows` + ANSI formatter (terminal
  output unchanged); rows are now reusable by markdown renderers.
- `apply` and `pr` share one `resolveAcceptedNode` helper.
- Public API: ledger module and the error taxonomy exported from the package root.
- Public JSON schema for ledger entries: `schema/paxcli.ledger-entry.schema.json`.
- New test suites: Proof Ledger, gates engine, Verification Card, receipts
  (95 tests, up from 63).

## 0.3.1 — 2026-08-15

- Repository questions ("how does X work?") are answered read-only in task mode instead
  of being treated as change requests.

## 0.3.0 — 2026-08-15

- **Simple Mode**: zero-config `npx paxcli "<task>"` — snapshot of your working tree
  (no commit required), auto-detected host and checks, isolated worktree, confirm-then-apply
  with a recovery patch. Honest labels: "checks passed", never "faster".

## 0.2.x — 2026-08-15

- 0.2.5: fix Linux hang at benchmark server shutdown.
- 0.2.4: UX fixes from first-user review.
- 0.2.3: fix event-log write race under parallel experiments.
- 0.2.2: **paxcli optimized itself** — live Claude Code run, bootstrap CI stats pipeline
  59.2 → 9.0 ms (−84.8%), grade Reproduced.
- 0.2.1: first public npm release; `npx paxcli demo`.
