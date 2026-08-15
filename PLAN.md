# ASCENT — Master Plan (v4)

*Verified autonomous code optimization. Open source. Built to be a company.*

---

## 0. The one-sentence story

> **Ascent uses coding agents to find performance improvements in your codebase — and produces proof that each improvement is real, safe, and reproducible.**

We never lead with tree search, TypeScript, worktrees, or architecture. We lead with outcomes:
**lower cloud bills · faster APIs · less time profiling · more performance wins shipped · safer use of autonomous coding agents.**

Positioning: an **independently built verified-optimization platform** inspired by the broader autoresearch category. Never described as an "evo copy" — no evo terminology, docs, or visual identity reused.

**The honest promise (north star):** *Ascent does not ask you to trust an agent's claim that code is better. It produces a reproducible receipt showing what improved, by how much, under which checks, and whether the result held in a fresh environment.*

**The final rule that governs all scope decisions:**
> Do not build more functionality until Ascent has produced a verified improvement that someone outside the team chooses to merge. That external merge is the first real proof the product — not the architecture — is valuable.

---

## 1. Who it's for (exact ICP) and what we support first

**Initial customer profile** (one persona, not "all developers"):
AI-native startups · Node.js backend APIs · 5–50 engineers · already using Claude Code · meaningful cloud bills · integration tests exist · latency/scaling pain · comfortable reviewing agent PRs. **Primary user: the backend team lead.**

**Officially supported repo type at launch** (one stack, exceptionally well):
> Node.js HTTP APIs using **Fastify or Express**, with Vitest/Jest tests and a reproducible local startup command.

Roadmap stacks (in order, each added only on demand evidence): NestJS → Python/FastAPI → Go services → SQL-heavy apps → LLM applications → frontend.

Confirmed foundations: TypeScript/Node ≥ 20, ESM, **single npm package `ascent`** (final name checked for npm/GitHub/domain/trademark at P0), no native deps (`npx` works everywhere), pnpm + tsup + vitest + Biome, Apache-2.0, **zero telemetry in v1**.

---

## 2. The product: Proof as the visible centerpiece

### 2.1 Verification grades (graded, never binary "proven")

| Grade | Meaning |
|---|---|
| **Measured** | Faster in the initial benchmark |
| **Validated** | Benchmark reliability checks passed |
| **Equivalent** | Visible + withheld behavior checks passed |
| **Reproduced** | Result held in a fresh environment |
| **Production-confirmed** | Result held in CI/staging/real traffic |

### 2.2 The Verification Card (shown for every result — terminal, receipt, PR, dashboard)

```
┌─ ASCENT VERIFICATION ─────────────────────────────────┐
│ p95 latency        412ms → 341ms   (−17.2%)           │
│ Verification       Reproduced                         │
│ Confidence         High (paired, n=24, CI −14%…−20%)  │
│ Tests              ✓ 148 passed                       │
│ Output equivalence ✓ 500/500 responses identical      │
│ Withheld checks    ✓ 40/40 passed                     │
│ Fresh reproduction ✓ held (−16.8%)                    │
│ Files protected    ✓ integrity verified               │
│ Cost to find       $1.83 · 22 min                     │
│ Commits            a3f19c2 → 7bd04e1                  │
│ Remaining risk     memory +3% (within constraint)     │
│ Human review       recommended: src/cache/layer.ts    │
└───────────────────────────────────────────────────────┘
```

### 2.3 Experiment receipts

Full contents: base/final commits, agent+model, prompt, tool permissions, benchmark/gate hashes, env + lockfile hash, OS/hardware, samples + variance, cost/tokens, diff, acceptance reason + grade, steering instructions given, exact repro command.
Privacy: **redacted + full variants** (share/export defaults to redacted), secret scanning before write, optional prompt storage, configurable retention, user-only file permissions, explicit warning before attaching anywhere public. `ascent run reproduce <id>` re-runs any receipt.

### 2.4 Production confirmation (the long-term differentiator, P2)

After a merge, Ascent compares before/after p50/p95, error rate, CPU, memory, throughput, and infra cost via **Datadog · New Relic · Grafana · OpenTelemetry · Sentry · CloudWatch · Prometheus** integrations, then upgrades the receipt to Production-confirmed with local + staging + production evidence side by side.

---

## 3. Discovery: find opportunities, don't just ask

`ascent benchmark discover` (and inside `ascent start`) identifies candidates from: slow integration tests, CPU-heavy functions, repeated serialization, N+1 queries, duplicate network requests, blocking fs ops, large allocations, inefficient loops, missing caching, excessive logging, slow middleware, expensive dependencies, existing profiling output, production traces (P2).

Each suggestion is **ranked** by expected impact, confidence, measurement difficulty, safety, estimated agent cost, and estimated engineering value. **The user always chooses what Ascent may attempt.**

### Optimization recipes (built-in, signed)

Launch recipes for the wedge: HTTP route latency · JSON parsing · serialization · DB query count · memory allocation · startup time · test-suite time · event-processing throughput · cache effectiveness · queue-worker throughput.
Each recipe = discovery rules + benchmark template + recommended sample count + correctness gates + protected files + reward-hack checks + report presentation. Community recipes later (P3), officially reviewed and signed.

---

## 4. Benchmark science (the wedge's hardest engineering)

**Formal lifecycle** (config-declared, harness-owned):
`setup → start app → readiness probe → warm-up → sample → reset (fixtures/DB/cache) → repeat → shutdown`
Harness owns: collision-free ports, process supervision + crash/orphan detection, connection-reuse policy, state reset, CPU/memory monitoring, machine-load detection, cold-start vs steady-state separation, throughput-under-load, post-restart re-verification.

**Statistics** (`src/bench/stats.ts`): minimum sample counts (p95 refused below threshold), warm-up exclusion, **interleaved baseline↔candidate paired comparison** (resists load drift), confidence intervals, effect size, declared outlier policy, flaky-benchmark warnings, environment-drift detection, regression tolerance, configurable confidence level. **Minimum meaningful improvement derives from measured noise — a tiny win inside the noise band is never accepted.** Never display precision the method doesn't support.

**Multi-objective** (visible tradeoffs, never hidden):
primary metric + hard constraints + secondary metrics + preferences. Example config: reduce p95; error rate must not rise; memory ≤ +10%; no new runtime dependency; public API unchanged; complexity bounded. Rejections cite the violated constraint: *"Rejected: increased memory by 17%."*

---

## 5. Safety: layered, visible, honest

### 5.1 Trust boundary (capability table, docs/trust-boundary.md)

| Capability | Enforced by |
|---|---|
| Env filtering (allowlist; agents never inherit full env) | Ascent process launcher |
| Protected-file detection | Hashes + git inspection |
| Command timeout / output / process caps | Process supervisor |
| Benchmark network policy | OS/container policy (P1+; best-effort before, stated) |
| Agent filesystem boundary | Host sandbox/container (v1 limitation documented) |
| Claude API access | Explicitly allowed, always |

### 5.2 Permission profiles — shown before every run

> *Ascent may modify `src/**`. It cannot modify tests, CI, deployment, or benchmark files. It may run `pnpm test` and `pnpm benchmark`. It cannot access production credentials.*

Profiles cover: readable/writable files, allowed commands, env allowlist, network yes/no, dependency installation yes/no, resource caps (processes/memory/disk), allowed domains, max duration/output. Levels: `sandboxed | standard (default) | trusted | custom` — a first-class product feature, not documentation. Container execution later for real isolation.

### 5.3 Reward-hacking defenses — "detects and reduces," never "prevents"

Detectors: modified benchmarks/fixtures, deleted/skipped tests, reduced assertions, hard-coded responses, benchmark-specific input detection, clock/seed manipulation, order-dependent caching, disabled validation, changed timeouts/runner config, modified lockfiles, suppressed errors, logging reduced to hide failures, external calls bypassing real work.
Layers: integrity hashes → behavioral equivalence → **withheld evaluator cases** → fresh reproduction → static suspicious-change rules → human review.
**Separate evaluator process** — implementation agents never control evaluation. Withheld cases: derived *after* discovery or user-supplied, stored evaluator-only, agents see only failure categories, rotated between campaigns. Documented plainly: not cryptographically hidden until process-boundary isolation lands.

### 5.4 Budget honesty

`Budget $2.00 · Current $1.74 · Max possible overshoot: one active agent call` — pre-spawn estimate + live cancellation on threshold + recorded actuals. Never marketed as a guaranteed hard cap.

---

## 6. Engine

- **Roles**: `quick` preset = one agent forms + implements the hypothesis. `balanced`/`deep` = researcher proposes structured hypotheses, executor implements. **Deterministic evaluator is engine code in every preset.**
- **Search (P0)**: best-first — branch from best accepted node, explicit root-branching allowed; events record enough to add epsilon-greedy/pareto later. Proof matters more than search strategy.
- **Human steering (P1)**: live instructions to an active run — "no caching," "focus on DB calls," "avoid new dependencies," "branch from experiment 12," "verify experiment 8 again" — recorded in receipt + audit log.
- **Research journal (P1)**: after every round — what was attempted / worked / failed, failure patterns, new codebase understanding, recommended next experiments, remaining bottlenecks. *Value even when no experiment wins.*
- **Main-repo safety**: snapshot status + HEAD at run start; compare only unexpected post-snapshot changes; warn/pause, never blame-and-abort (users legitimately edit during runs).
- **Branch lifecycle**: rejected → auto-deleted (or `gc`); accepted non-winners → retained until run archival; winner → **`ascent/winner/<run-id>`**; `apply` optionally renames; `gc --all-runs` confirms before removing archives.
- **Event store**: JSONL, schema-versioned, monotonic sequence numbers, truncate-incomplete-tail recovery, atomic snapshots, lock = PID + process-start identity (Windows PID reuse), idempotent replay, config/policy hashes in run-start event, migration support before beta.
- **Later (P2/P3)**: hypothesis dedup, early-cancel of inferior experiments, budget re-allocation to promising branches, cheap-model research + strong-model implementation, model/agent comparison ("which model is most cost-effective for this repo"), optimization memory per repo, insight expiry after major code change, automatic bisection.

---

## 7. CLI

### Command hierarchy

```
PRIMARY      ascent demo · start · resume · status · apply · doctor
RUNS         ascent run list|show|explain|compare|cancel|archive|delete|reproduce|report
BENCHMARK    ascent benchmark discover|validate|run|compare|explain-noise
POLICY       ascent policy show|audit|validate|permissions · ascent secrets scan
MAINTENANCE  ascent gc · repair · upgrade · completion · config validate
AUTOMATION   ascent ci verify|optimize · pr · export · import        (P2)
```
Beginners see six commands; everything advanced is nested. README examples use `ascent start` almost exclusively.
Mental model: `start` = guided end-to-end · `discover` = configure without optimizing · `optimize` = run existing config · `resume` = continue.

### Presets (outcome-oriented; expansion shown before execution)

`quick` (2 low-cost experiments) · `balanced` · `deep` · `overnight` (deadline+budget) · `ci` (deterministic, non-interactive) · `safe` (no network/deps) · `explore` (diverse hypotheses) · `verify-only` (verify an existing branch).

### Terminal experience

Shows: stage, current hypothesis, active experiments, cost so far, ETA, baseline vs best, gate results, rejection summary, confidence, safe-Ctrl-C notice, resume command. Plain-English statuses:
*"Measuring baseline stability" · "Testing response-cache hypothesis" · "Rejected: increased memory by 17%" · "Reproducing the current winner" · "Accepted: p95 improved 14%, all equivalence checks passed."*
Raw agent logs only under `--verbose`. **`--json`: stdout = stable schema-versioned JSON only; stderr = progress; no colors/spinners; documented exit codes; interruptions emit machine-readable resumable status.**

### Explain & compare

`run explain <id>`: what the agent attempted, why it expected improvement, files changed, why performance changed, why accepted/rejected, remaining risks, what a reviewer should inspect, whether the technique generalizes.
`run compare A B`: score, memory, cost, diff size, gates, confidence, dependencies, complexity, agent explanation — side by side.

### First-run promises (controllable, honest)

- `ascent start`: **under five minutes to configure and begin the first experiment** (preflight with exact repair instructions; `--dry-run` shows planned experiments + estimated cost).
- `ascent demo`: **a complete verified result in under five minutes** — bundled `examples/demo-api` + MockHostAdapter with canned patches, one of which is a tempting reward-hack that the Proof Layer visibly rejects. Zero auth required. Doubles as e2e test and README GIF.

---

## 8. Dashboard (decision-oriented, never the critical path)

The verified result is the product — not the tree visualization. Engine is fully functional headless; dashboard is lazily started, optional, rebuilt entirely from event state.

**P1 (simple)**: current winner · verification grade · cost · improvement · remaining risk · **apply/reject decision**. A table, not an art project.
**P2+**: experiment tree, score-vs-cost chart, latency/memory Pareto, node comparison, diff viewer, live logs, gate history, benchmark distributions, timeline replay, research journal, filters, run comparison, production-confirmation status.
Security even read-only: 127.0.0.1, random session token, strict Host validation (DNS-rebinding protection), no permissive CORS, CSP, trace redaction, no unsafe HTML, idle auto-shutdown.

---

## 9. GitHub: distribution built into the product (P2)

App behaviors: `@ascent optimize this endpoint` comments · `ascent-optimize` label · scheduled runs · run-after-regression · evidence-backed PRs · benchmark results as checks · approval before expensive runs · re-verify when base branch moves · close stale optimization PRs.

**Every PR contains**: before/after metrics, confidence, gates, cost, repro command, verification level, risks, and the **"Verified by Ascent"** footer — the primary growth loop:
*Ascent opens a useful PR → teammates see the evidence → they install it on another repo → more verified PRs.*

**CI + regression prevention** (turns one-time wins into a continuously useful product): performance-budget checks, baseline snapshots, regression alerts, scheduled verification, auto-issue creation, suggested repair runs, per-branch performance history.

**Growth loops**: shareable redacted reports · PR footer · repo performance badge · public optimization gallery · **open-source optimization campaign (optimize popular OSS repos, submit legitimate upstream PRs — merged external PRs are the strongest product evidence)** · community benchmark challenges · signed official recipes · monthly verified-savings report · recipe-author attribution.

**Delight (professional, optional)**: human-readable experiment names, animated tree, session replay, before/after performance cards, milestone/desktop notifications, "overnight research completed" summaries, repo improvement history. Celebrate verified wins — never token counts or agent counts.

---

## 10. Business model (open-core, defined early)

**Free/open source forever**: local engine, single-repo use, worktrees, host adapters, gates, recipes, receipts, exportable reports.
**Paid team product**: GitHub org integration, scheduled runs, shared dashboard, remote workers, centralized budgets, approval workflows, org policies, long-term history, notifications.
**Enterprise**: self-hosted control plane, SSO, RBAC, audit logs, private networking, data residency, production-monitoring integrations, support/SLA.
Pricing candidates: per active repository / per worker-hour / platform + compute. **Never token markup** — customers bring their own model accounts.
**Moat over time**: best proof + benchmark-reliability system, recipe knowledge, repo-specific optimization memory, GitHub distribution, production-validation integrations, (later, consent-only) learning what succeeds without collecting code.

---

## 11. Execution: P0 → P3 with hard gates

### P0 — Prove the concept
**Build**: scaffold + CI (win/mac/linux) · benchmark harness lifecycle + core stats · output equivalence · Minimum Proof (pins, command gates, repeated benchmarks, simple receipt) · Claude Code adapter (stream-json, cost capture, cancel, contract fixtures) · worktree isolation + branch lifecycle · cost/time limits · `demo/start/resume/status/apply/doctor` + `workspace gc` · excellent `ascent demo`.
**Validate (exit gate — before any P1 code)**: 10 customer interviews (script: docs/design-partners.md) · 3 external repos offered · 2 users willing to run a trial · one evidenced repeated pain · **first externally merged improvement**.

### P1 — Make people return
Resume/crash recovery hardening · Full Proof (paired-interleaved stats, withheld cases, adversarial fixture suite, fresh reproduction) · research journal · ranked discovery · explain/compare · human steering · GitHub PR generation (`ascent pr`) · Codex adapter · simple decision dashboard · redacted receipts · policy enforcement.
**Gate**: 5 design partners · ≥5 merged optimization PRs · ≥1 customer runs Ascent twice unprompted.

### P2 — Create distribution
GitHub App · CI checks + performance budgets · scheduled optimization · badges · shareable reports · open-source optimization campaign · production-monitoring integrations (first: OpenTelemetry + Datadog) · first Production-confirmed receipt.
**Gate**: first paying user.

### P3 — Build the company
Team dashboard · remote execution · org policies · SSO/audit · optimization packs (FastAPI, SQL, LLM apps) · community recipes (signed) · paid pilots · enterprise self-hosting.
**Gate**: teams pay for repeated use.

### Metrics from day one (local instrumentation, no telemetry)
Funnel: setup completed → first experiment → candidate → Reproduced → PR offered → **merged** → repeat run ≤30 days. Plus: cost/time per merged improvement, post-merge reversions, engineering hours saved, infra cost reduced. Headline: **% of onboarded repos that merge one verified improvement and run Ascent again within 30 days.** Demo-repo and external-repo numbers always reported separately.

### The 60-second YC demo (build toward exactly this)
Real external backend repo → one command → Ascent finds the slow endpoint → several approaches tested in parallel → **a tempting but incorrect optimization is rejected by withheld checks** → a correct one improves latency → reproduces fresh → clear PR with the Verification Card → owner merges → production metrics later confirm. No command tours, no architecture slides.

---

## 12. Anti-goals (the traps we will not fall into)

No cloud backends before demand · no multi-language sprawl · no months on the dashboard · no "perfect sandbox" claims · no statistical certainty from small samples · no "secret" withheld files without enforced isolation · no invisible spending · no synthetic-demo-only optimization · no star-counting instead of retention · no plugin marketplace before third parties ask · no evo terminology/docs/visual identity · no "tests passed = safe" · **no auto-merging, ever** · no features without user evidence.

## 13. Legal guardrails

No evo code/text/branding copied · independent architecture notes kept (this plan + BACKLOG.md + ASCENT_REVIEW_POINTS.md) · dependency-license audit before publish · SECURITY.md responsible disclosure · clear data policy (no telemetry v1; later strictly opt-in with documented payload).

---

## 14. Repository layout

```
hqvil/
├── package.json  tsconfig.json  biome.json  vitest.config.ts  tsup.config.ts
├── src/
│   ├── cli/            # commander: primary + nested command groups
│   ├── engine/         # run-loop, roles, resume, budget, steering
│   ├── tree/           # node types, versioned JSONL event store
│   ├── bench/          # harness.ts (lifecycle) + stats.ts (paired interleaved)
│   ├── discovery/      # opportunity scanners + ranking
│   ├── recipes/        # built-in optimization recipes (wedge set)
│   ├── proof/          # grades, pins, withheld cases, detectors, receipts, re-verify
│   ├── gates/          # command gates, inheritance
│   ├── policy/         # permission profiles, env allowlist, secrets scan
│   ├── hosts/          # HostAdapter + claude-code/ + mock/  (+ codex/ in P1)
│   ├── worktree/       # git backend, branch lifecycle, Windows-safe cleanup
│   ├── insights/       # journal, rejected hypotheses, prompt digest
│   ├── report/         # verification card, terminal UI, markdown reports
│   └── config/         # zod schema — single source of truth
├── examples/demo-api/  # Fastify app with slow endpoints (drives `ascent demo`)
├── docs/               # quickstart, proof-layer, trust-boundary, benchmark,
│                       # recipes, design-partners (interview script)
├── BACKLOG.md README.md CONTRIBUTING.md LICENSE SECURITY.md CODE_OF_CONDUCT.md
└── .github/workflows/ci.yml
```

Critical files: `src/bench/harness.ts` + `src/bench/stats.ts` (credibility flows from here) · `src/proof/` (the differentiator) · `src/engine/run-loop.ts` (composition point) · `src/hosts/claude-code/adapter.ts` · `src/worktree/local.ts` (Windows EBUSY handling) · `src/config/schema.ts`.

---

## 15. Verification of the build itself

- Every phase: `pnpm build && pnpm test` green locally (Windows) + CI matrix.
- **P0 demo gate**: `npx ascent demo` on a clean checkout — baseline measured with stability check, canned reward-hack rejected with a plain-English reason on the Verification Card, winner accepted at grade Measured with honest stats, `gc` leaves only `ascent/winner/<run-id>`, zero worktrees.
- **P0 real-run gate** (user's Claude auth): `ascent start --preset quick --budget 2` on examples/demo-api → receipt written, permission summary shown pre-run, budget display shows overshoot honestly, `apply` creates the winner branch.
- **P1**: adversarial fixture suite fully green (edited benchmark, skipped tests, hard-coded outputs, clock/fixture manipulation — all caught) · kill -9 mid-run → `resume` continues · `run reproduce <id>` succeeds in a fresh worktree · withheld-case failures surface only categories to agents.
- **Stats sanity**: synthetic benchmarks with known variance — p95 refused below min samples; no improvement smaller than measured noise ever accepted.
- **Publish**: `npx ascent@<version> demo` from a clean temp dir; `--json` stdout validates against its schema.
