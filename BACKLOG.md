# Backlog

Deferred work, ordered by the P0→P3 ladder in PLAN.md. The rule that governs everything here: **nothing expands until Paxcli has produced a verified improvement that someone outside the team chooses to merge.**

## P1 — Make people return

- [ ] **Codex CLI host adapter** (`src/hosts/codex/`) — parse `codex exec --json`; cost via static price table (Codex reports tokens, not USD). *(good first issue)*
- [ ] **Paired interleaved sampling** — alternate baseline/candidate measurement to resist machine-load drift; bootstrap confidence intervals; effect size.
- [ ] **Withheld evaluator cases** — evaluator-only holdout location, agents see only failure categories, rotation between campaigns. Until real process isolation: keep calling them "withheld", never "hidden".
- [ ] **Fresh-workspace reproduction** — re-run the winner in a brand-new worktree after all agents stop; grade `reproduced`; `paxcli run reproduce <id>` (receipt field already exists).
- [ ] **More reward-hack detectors** — skipped/weakened test detection, timing/seed manipulation, lockfile changes, suppressed errors. Each with an adversarial test.
- [ ] **Research journal** — per-round summary of what was tried/learned; value even when nothing wins.
- [ ] **Ranked discovery** — scan for slow tests, N+1 queries, blocking fs calls; rank by impact × confidence × cost; user picks.
- [ ] **Human steering** — live instructions to an active run, recorded in receipts.
- [ ] **`paxcli pr`** — open a GitHub PR with the Verification Card and "Verified by Paxcli" footer.
- [ ] **Redacted receipts** — secret scanning before write; redacted variant is the share/export default.
- [ ] **Simple decision dashboard** — read-only, 127.0.0.1 + session token, SSE over events.jsonl.
- [ ] **Researcher/executor role split** for balanced/deep presets.
- [ ] **Epsilon-greedy frontier** — events already record enough to add alternatives to best-first.

## P2 — Create distribution

- [ ] GitHub App (`@paxcli optimize` comments, scheduled runs, evidence-backed PRs, re-verify on base change)
- [ ] CI commands (`paxcli ci verify`, performance budgets, regression alerts)
- [ ] Production confirmation (OpenTelemetry, Datadog first) → grade `production-confirmed`
- [ ] Shareable redacted reports; repo performance badge
- [ ] Open-source optimization campaign (upstream PRs to real projects)

## P3 — Build the company

- [ ] Team dashboard, org policies, SSO/audit, remote workers
- [ ] Optimization packs: FastAPI, SQL, LLM apps, bundle size
- [ ] Signed community recipes
- [ ] Container-backed isolation mode
- [ ] Opt-in telemetry with documented payload (off remains the default)

## Engineering debt / known limitations

- Budget can overshoot by one active agent call (documented; needs live mid-run cancellation on cost threshold).
- `server` benchmark mode assumes the app reads `PORT`; document patterns for apps that don't.
- Event-log schema migrations: versioned envelope exists; migration runner needed before 1.0.
- Worktree `npm install` story for repos whose benchmark needs `node_modules` (currently: use `setupCmd`).
- Dashboard: none yet, by design (P1).
