# Paxcli

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
| **Equivalent** | Behavior checks passed *(P1)* |
| **Reproduced** | Held in a fresh environment *(P1)* |
| **Production-confirmed** | Held in CI/staging/real traffic *(P2)* |

Layered defenses, honestly framed — Paxcli **detects and reduces** common reward-hacking techniques, it does not claim to prevent all of them:

- **Integrity pins**: protected files (benchmarks, tests, CI, config) are hash-pinned via git blobs and verified *before* any score is computed — in the working tree and the whole experiment ancestry.
- **Gates**: your test suite and output-equivalence checks run on every experiment. Any failure rejects it regardless of speed.
- **Noise-derived thresholds**: an improvement smaller than the measured benchmark noise is never accepted. p95 is refused below 20 observations.
- **Env filtering**: agents receive an allowlist of environment variables, never your full environment.
- **Deterministic evaluator**: engine code decides acceptance. No agent ever judges its own work.

Details and limitations: [docs/trust-boundary.md](docs/trust-boundary.md) · [docs/proof-layer.md](docs/proof-layer.md)

## Commands

```
paxcli demo                 the full experience on a bundled slow API
paxcli start                guided run on this repository
paxcli resume               continue an interrupted run
paxcli status               latest run at a glance
paxcli apply [nodeId]       create a reviewable winner branch
paxcli doctor               environment checks with exact repair steps
paxcli gc [--branches]      clean worktrees / experiment branches

paxcli run list             past runs
paxcli run explain <id>     full receipt + Verification Card
paxcli benchmark validate   is your benchmark reliable enough to optimize against?
paxcli config validate      validate paxcli.config.json
```

Every command supports `--json`: stable JSON on stdout, progress on stderr.

## Supported today

- **Repos**: Node.js HTTP APIs (Fastify/Express or anything with a start command + readiness URL), or any repo whose benchmark fits a single sample command.
- **Agents**: Claude Code. (Codex CLI is next — the `HostAdapter` interface is 4 methods; contributions welcome.)
- **Platforms**: Windows, macOS, Linux. Node ≥ 20.

## What Paxcli is not

- It does not merge code. Ever.
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
