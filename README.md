# Paxcli

[![npm version](https://img.shields.io/npm/v/paxcli)](https://www.npmjs.com/package/paxcli)
[![CI](https://github.com/harikantbajaj/paxcli/actions/workflows/ci.yml/badge.svg)](https://github.com/harikantbajaj/paxcli/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Verified autonomous code optimization.** Coding agents find performance improvements in your codebase — Paxcli produces proof that each improvement is real, safe, and reproducible.

> Paxcli does not ask you to trust an agent's claim that code is better. It produces a reproducible receipt showing what improved, by how much, under which checks, and whether the result held.

```
┌─ PAXCLI VERIFICATION ────────────────────────────────────────────┐
│ report_latency_ms         51 → 7 (−87%, noise ±5%)               │
│ Verification              Validated — reliability checks passed  │
│ Threshold                 improvement must exceed 5.0%           │
│ Gate: unit tests          ✓ passed                               │
│ Gate: output equivalence  ✓ passed                               │
│ Files protected           ✓ integrity verified                   │
│ Cost to find              $0.01 · 22s                            │
│ Decision                  ✓ Accepted: improved 86.9% vs baseline │
└──────────────────────────────────────────────────────────────────┘
```

## Just describe a change

```bash
cd my-project
npx paxcli
# What do you want to change?
# > Improve the form-submission page UI and make it responsive
```

That's the whole setup. Paxcli detects your coding agent (Claude Code or Codex), snapshots your working tree — committed, uncommitted, and untracked files, no commit required — discovers your test/lint/build commands, and hands the task to the agent in an isolated git worktree. Checks must pass (failures go back to the agent for up to two repair attempts), then the agent-only diff is applied to your working directory with your confirmation, unstaged, with a recovery patch saved. Existing tests, CI workflows, and credentials are integrity-pinned — an agent that touches them is auto-rejected.

Honest labels, always: a UI change gets **"checks passed"**, never "faster" or "better". The verified vocabulary below (Measured / Validated / Equivalent / Reproduced) is reserved for benchmark-backed optimization — which performance-flavored requests use automatically when a benchmark is configured.

## See it in two minutes — no API keys

```bash
npx paxcli demo
```

The demo copies a deliberately slow HTTP API into a temp repo and lets a scripted agent try three ideas:

1. **"Benchmark the cheap /health endpoint instead"** → rejected: it edited a protected benchmark file, caught by integrity pins before any score existed.
2. **"Serve a precomputed cached constant"** → rejected: the unit-test gate caught the wrong output. A faster wrong answer is still wrong.
3. **A genuine algorithmic fix** (quadratic scans → Set + sort) → accepted: ~87% latency improvement, all gates passed, Verification Card printed.

That is the whole product in miniature: agents propose, a deterministic evaluator decides, and cheating loses.

## Use it on your repository

Requires [Claude Code](https://docs.anthropic.com/claude-code) installed and signed in, plus a git repo with tests.

```bash
cd your-api-repo
npx paxcli start          # creates paxcli.config.json template on first run
# fill in your benchmark command + gates, commit, then:
npx paxcli start --preset quick --budget 2
```

Paxcli shows a permission summary, measures your baseline (and refuses to optimize against a noisy benchmark), then runs parallel experiments in isolated git worktrees. Winners land on a branch — **Paxcli never merges for you**:

```bash
paxcli apply              # creates paxcli/winner/<run-id>
git diff HEAD...paxcli/winner/<run-id>
```

## How results are verified

| Grade | Meaning |
|---|---|
| **Measured** | Beat the local benchmark |
| **Validated** | Benchmark reliability checks passed |
| **Equivalent** | Visible + withheld behavior checks passed |
| **Reproduced** | Held when re-measured in brand-new worktrees, interleaved with a fresh baseline |
| **Production-confirmed** | Held in CI/staging/real traffic *(roadmap)* |

Layered defenses, honestly framed — Paxcli **detects and reduces** common reward-hacking techniques, it does not claim to prevent all of them:

- **Integrity pins**: protected files (benchmarks, tests, CI, config) are hash-pinned via git blobs and verified *before* any score is computed — in the working tree and the whole experiment ancestry.
- **Static hack detectors**: skipped/focused tests, timing and randomness monkey-patching, and forbidden lockfile changes reject the experiment; softer signals (empty catches, net assertion removal) land on the receipt as *remaining risks* for the reviewer.
- **Gates**: your test suite and output-equivalence checks run on every experiment. Any failure rejects it regardless of speed.
- **Withheld evaluator cases**: behavior checks whose inputs live outside the worktree (`.paxcli/withheld/`, gitignored). Agents only ever learn the failure category — never the inputs or expected outputs.
- **Fresh reproduction**: the winner is re-measured in brand-new worktrees against a fresh baseline (interleaved, so machine drift hits both sides) before it earns the *Reproduced* grade.
- **Noise-derived thresholds**: an improvement smaller than the measured benchmark noise is never accepted; bootstrap 95% confidence intervals and effect size are reported when samples allow; p95 is refused below 20 observations.
- **Env filtering**: agents receive an allowlist of environment variables, never your full environment.
- **Redacted receipts**: every receipt gets a secret-scrubbed variant, and that's the only one reports and PRs ever use.
- **Deterministic evaluator**: engine code decides acceptance. No agent ever judges its own work — including in split-role mode, where a researcher proposes and an executor implements.

Details and limitations: [docs/trust-boundary.md](docs/trust-boundary.md) · [docs/proof-layer.md](docs/proof-layer.md)

## Commands

```
paxcli [request]            describe any change; isolate → implement → validate → apply
paxcli demo                 the full experience on a bundled slow API
paxcli start                guided run on this repository
paxcli resume               continue an interrupted run
paxcli status               latest run at a glance
paxcli apply [nodeId]       create a reviewable winner branch
paxcli steer <message>      instruct an active run (picked up next round)
paxcli dashboard            read-only live view (127.0.0.1, token-protected)
paxcli pr [nodeId]          open a GitHub PR with the evidence attached
paxcli doctor               environment checks with exact repair steps
paxcli gc [--branches]      clean worktrees / experiment branches

paxcli run list             past runs
paxcli run explain <id>     full receipt + Verification Card
paxcli run reproduce <id>   re-verify a result in brand-new worktrees
paxcli run report           shareable (redacted) markdown report
paxcli benchmark validate   is your benchmark reliable enough to optimize against?
paxcli benchmark discover   ranked optimization opportunities (static heuristics)
paxcli ci baseline          store a performance baseline snapshot
paxcli ci verify            fail CI when performance regresses beyond tolerance
paxcli config validate      validate paxcli.config.json
```

Every command supports `--json`: stable JSON on stdout, progress on stderr. Each run also writes a **research journal** (`.paxcli/runs/<id>/journal.md`) — what was tried, what worked, what got ruled out — so even a run with no winner leaves knowledge behind.

## Supported today

- **Repos**: Node.js HTTP APIs (Fastify/Express or anything with a start command + readiness URL), or any repo whose benchmark fits a single sample command.
- **Agents**: Claude Code and Codex CLI (`host.id` in config, or `--host`). Adding another host is a 4-method `HostAdapter`.
- **Platforms**: Windows, macOS, Linux. Node ≥ 20.

## What Paxcli is not

- It does not merge or commit code. Ever. Task results land unstaged in your working directory only after your confirmation; optimization winners land on a branch you review.
- It does not claim statistical certainty small samples can't support.
- It does not send telemetry. There is none in this version.
- It is not a sandbox: agents run with your user account's permissions inside a worktree. Read [docs/trust-boundary.md](docs/trust-boundary.md) before running on sensitive repositories.

## Development

```bash
npm install
npm run check      # typecheck + lint + tests
npm run build
node dist/cli.js demo
```

Architecture notes live in [PLAN.md](PLAN.md); deferred work in [BACKLOG.md](BACKLOG.md).

## License

Apache-2.0
