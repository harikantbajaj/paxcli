# Backlog

Deferred work, ordered by the P0→P3 ladder in PLAN.md. The rule that governs everything here: **nothing expands until Paxcli has produced a verified improvement that someone outside the team chooses to merge.**

## Shipped (P0 + P1 + buildable P2)

- [x] Engine, worktree isolation, benchmark harness, integrity pins, gates, receipts, Verification Card, CLI, demo (P0)
- [x] Codex CLI host adapter
- [x] Bootstrap 95% confidence intervals + effect size; interleaved fresh-baseline sampling in the reproduction step
- [x] Withheld evaluator cases (evaluator-only inputs, category-only feedback to agents)
- [x] Fresh-workspace reproduction → grade `reproduced`; `paxcli run reproduce`
- [x] Static reward-hack detectors (skipped/focused tests, timing/seed monkey-patching, lockfile changes, suppressed errors, weakened assertions) with adversarial tests
- [x] Research journal per round
- [x] Ranked static discovery (`paxcli benchmark discover`)
- [x] Human steering (`paxcli steer`, read at round boundaries, recorded in prompts)
- [x] `paxcli pr` — evidence-backed GitHub PR via gh
- [x] Redacted receipts (secret scanning; reports/PRs use redacted variants only)
- [x] Read-only decision dashboard (token, Host validation, CSP, SSE, idle shutdown)
- [x] Researcher/executor role split (`search.roles: "split"`)
- [x] Epsilon-greedy frontier (`search.strategy: "epsilon-greedy"`)
- [x] `paxcli ci baseline` / `paxcli ci verify` — regression prevention

## Remaining P2 — distribution (needs hosting/accounts, not just code)

- [ ] GitHub App (`@paxcli optimize` comments, scheduled runs, re-verify on base change) — requires registering an app + a webhook host
- [ ] Production confirmation integrations (OpenTelemetry, Datadog) → grade `production-confirmed` — requires partner accounts to test against
- [ ] Public repo performance badge service
- [ ] Open-source optimization campaign (run paxcli on real OSS repos, submit upstream PRs — the strongest product evidence)

## P3 — company (services, not CLI code)

- [ ] Team dashboard, org policies, SSO/audit, remote workers, self-hosted control plane
- [ ] Optimization packs: FastAPI, SQL, LLM apps, bundle size
- [ ] Signed community recipes
- [ ] Container-backed isolation mode
- [ ] Opt-in telemetry with documented payload (off remains the default)

## Validation gates (user work, not code)

- [ ] 10 design-partner interviews (script: docs/design-partners.md)
- [ ] 3 external repositories run paxcli; **first externally merged improvement**
- [ ] ≥5 merged optimization PRs; ≥1 team runs paxcli twice unprompted
- [ ] First paying user

## Engineering debt / known limitations

- Budget can overshoot by one active agent call (documented; live mid-run cancellation on cost threshold would tighten it).
- Withheld cases are kept out of worktrees, not process-isolated — a local agent could in principle read the directory (documented in docs/trust-boundary.md).
- Codex adapter reports tokens, not USD (Codex does not expose cost); budget tracking for Codex runs is time/token-based.
- Event-log schema migrations: versioned envelope exists; migration runner needed before 1.0.
- Discovery is static heuristics only; profiling/trace-driven discovery is future work.
