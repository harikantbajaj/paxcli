# The Proof Layer

Paxcli's core claim is not "agents can make code faster" — it is that you can **trust the acceptance decision**. This document explains exactly what that trust rests on, and where its edges are.

## Verification grades

Results are graded, never binary:

1. **Measured** — beat the local benchmark.
2. **Validated** — benchmark reliability checks passed (stable baseline, improvement above the noise floor).
3. **Equivalent** — visible gates *and* withheld behavior checks passed.
4. **Reproduced** — held when re-measured in brand-new worktrees, interleaved with a fresh baseline, after all agents stopped.
5. **Production-confirmed** — held in CI/staging/production metrics *(roadmap — requires monitoring integrations)*.

The current release reaches **Reproduced**. Nothing is ever displayed as more verified than it is.

## The evaluation pipeline

Every experiment passes through, in order:

1. **Integrity pins.** Protected files (benchmark, tests, config, CI) are pinned by git blob hash at run start. Verification happens *before any score is computed*, and covers both the working tree and every commit in the experiment's ancestry. Blob hashes make this immune to CRLF normalization differences across platforms.
2. **Change check.** No diff → rejected.
3. **Benchmark.** The harness owns the lifecycle: free-port selection, app start, readiness probe, warm-up, N samples, shutdown. The score is the sample median.
4. **Constraints.** Secondary metrics (memory, etc.) must stay within configured bounds vs baseline.
5. **Gates.** Test suites and equivalence checks, run inside the worktree. First failure stops the pipeline.
6. **Noise-floor threshold.** The required improvement is `max(measured noise CV, configured minimum)`. An improvement inside the noise band is rejected with the measured numbers shown.

The evaluator is deterministic engine code. **No agent decides whether work is accepted** — not its own, not another agent's.

## Statistics that refuse to overclaim

- p95 is refused below 20 observations (`MIN_SAMPLES_FOR_P95`) — small-sample tail percentiles are noise dressed as precision.
- Display precision follows sample count.
- A baseline whose coefficient of variation exceeds 10% aborts the run with instructions to fix the benchmark first.

## Receipts

Every experiment — accepted or rejected — writes a receipt (`.paxcli/runs/<run>/receipts/<node>.json`): commits, hypothesis, agent cost/tokens, samples, gate outputs, pin status, environment, decision reason, and the exact reproduce command. `paxcli run explain <id>` renders it.

## The Proof Ledger

Receipts live under gitignored `.paxcli/`; the **Proof Ledger** (`PROOF.md`, configurable via `ledger.path`) is the repo-visible, committable projection of them. When you apply a result, paxcli appends an entry: a markdown verification card plus an embedded machine-readable JSON block (`ledgerEntryVersion: 1`, validated by a zod schema, always built from the *redacted* receipt — raw gate output and agent text never reach it).

Properties worth trusting:

- **Append-only and idempotent.** Entries are keyed by run/experiment id; re-applying the same winner never duplicates an entry.
- **Self-verifying.** `paxcli ledger verify` re-parses every embedded receipt, recomputes the stats header, and flags duplicates or tampering (exit 1). Commits referenced by entries that no longer exist locally (gc, rebase, shallow clone) are reported as warnings, not errors.
- **Honest by construction.** The entry schema only allows the verified vocabulary on benchmark-backed optimization entries. Task entries are constrained to `"checks passed"` or `"applied — not verified by paxcli"` — there is no field in which to overclaim.
- **Never load-bearing.** Ledger writes are unstaged, best-effort, and cannot fail a run or an apply.

## Honest limitations

Paxcli **detects and reduces** common reward-hacking techniques. It does not prevent all of them. Examples that pins and gates do *not* currently catch:

- application code that special-cases benchmark-shaped inputs without touching protected files,
- caching that only helps because of benchmark request ordering,
- behavior changes outside what tests and equivalence fixtures cover.

Mitigations on the roadmap (withheld evaluator cases, fresh-workspace reproduction, suspicious-change rules) narrow these gaps — and human review of the winner diff remains part of the design, which is why Paxcli produces a reviewable branch instead of merging.
