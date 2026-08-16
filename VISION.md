# Vision — The Proof Layer

> Status: north-star narrative, written 2026-08-16. PLAN.md governs what gets built now;
> BACKLOG.md governs what's deferred. This document governs *why* — the company the CLI
> is the seed of. Nothing here overrides the final rule at the bottom.

## One line

**Paxcli is the trust layer for autonomous software engineering.** Coding agents claim
their changes are better; Paxcli produces deterministic, reproducible proof — and the
company is built on the conviction that proof, not code generation, becomes the
bottleneck of the agent era.

## The problem, stated plainly

Within a few years the majority of code changes will be written by agents. At that point
the scarce resource in software engineering stops being *writing* code and becomes
*trusting* code. Every company running agent fleets will face the same question thousands
of times a day:

> An agent claims this change is good. Is it?

Today the answer is "a human reviews it." That does not scale past a handful of agents,
and it fails in a specific, dangerous way: agents are optimizers, and unverified
optimizers reward-hack. We watched it happen on day one — our own demo agent tried to
benchmark the cheap endpoint and to serve a precomputed constant before it ever tried a
real fix. Both were caught mechanically, before any score existed.

Whoever owns the automated, adversarial-resistant answer to "is this claim real?" owns a
layer of infrastructure every AI-native company needs. That is the layer we are building.

## Why performance is the wedge (and only the wedge)

Performance optimization is the beachhead, not the product, chosen because it is the
**hardest claim to fake and the easiest to verify honestly**:

- "Faster" is objectively measurable, so the Proof Layer can be held to a standard no
  human reviewer meets: noise-derived thresholds, bootstrap confidence intervals,
  integrity-pinned benchmarks, withheld behavior checks, fresh-worktree reproduction.
- The buyer pain is denominated in real money (cloud bills, latency SLOs).
- Cheating is rampant and demonstrable, which makes the counter-machinery visibly
  valuable in a two-minute demo.

Proof of the wedge working: **paxcli optimized itself** — a live Claude Code agent cut
our bootstrap-CI computation by 84.8%, the result graded *Reproduced* in fresh worktrees
against an interleaved baseline, merged, and shipped as v0.2.2.

## The expansion ladder

We expand along one axis: *what kinds of agent claims can we verify?* Each rung reuses
the same core — snapshot, isolate, pin, gate, measure, reproduce, receipt — re-aimed at a
new claim type. Each rung is a larger market than the one below it.

| Rung | Claim verified | Why it's next |
|---|---|---|
| 1. Performance *(now)* | "This is faster." | Measurable, noise-aware, reproducible. The beachhead. |
| 2. Cloud cost | "This cuts your bill by $X/month." | Same machinery, dollar-denominated receipts. CFO-legible. Mostly a metrics-mapping problem. |
| 3. Correctness-preserving change | "This migration/refactor/upgrade changes nothing." | Equivalence gates + withheld cases already do this; Simple Mode is its seed. Dependency major-version upgrades alone are an enormous market. |
| 4. Security patches | "This fixes the CVE without breaking behavior." | Verified auto-remediation; compliance budgets are the easiest budgets in software. |
| 5. Any agent change | "No receipt, no merge." | The endgame: receipts as the standard artifact on every agent-authored PR, the way CI status checks are today. |

## Platform plays (where it stops being a CLI)

**Proof-as-a-Service API.** Agent products — copilots, SRE agents, migration bots — do
not want to build integrity pins, reward-hack detectors, and noise models themselves.
Sell them `POST /verify`: submit a diff + claim, receive a graded receipt. Every agent
company becomes a customer instead of a competitor.

**The grade ladder as an industry standard.** Measured / Validated / Equivalent /
Reproduced / Production-confirmed is publishable vocabulary. Release it as an open spec
(working name: *Verified Change Levels*), the way SemVer and SLSA were standardized.
Adoption of the vocabulary makes the reference implementation — ours — the default.

**The receipt network.** Every receipt is structured, verified outcome data: technique,
stack, improvement, rejection reasons. At scale this is the world's only dataset of
*what optimizations actually work where* — everyone else has claims; we have outcomes.
It powers discovery that improves with every run ("repos like yours: 84% acceptance on
N+1 fixes"), a public verified-optimization gallery, and **model leaderboards ranked by
verified merged outcome per dollar** — a leaderboard only we can compute, citable by the
whole industry.

**The fleet plane.** Once receipts are trusted, the ask becomes "run this continuously":
overnight optimization and maintenance fleets across every service, org policies
("agents never touch auth code"), budget governance, approval workflows, audit, SSO.
The CLI stays free forever; the fleet plane is the enterprise product — the governance
console for a company's entire agent workforce.

**Outcome-based pricing.** The boldest monetization: a percentage of *verified*
infrastructure savings. Nobody else can price on outcomes because nobody else can prove
the outcome. The Proof Layer is literally a billing meter.

## Moats

1. **The receipt corpus** — verified-outcome data across stacks; every run sharpens
   discovery and thresholds. A data network effect competitors can't shortcut.
2. **The adversarial arms race** — reward-hack detection is a red-queen game. Years of
   accumulated detectors, withheld-case patterns, and per-stack noise models are exactly
   the unglamorous depth that copilot startups and model labs won't rebuild.
3. **The trust brand** — honest claims only: *detection not prevention*, noise-aware
   refusals, "withheld" not "hidden," never auto-merging. In a market drowning in AI
   overclaiming, the company that refuses to overclaim becomes the default for auditors,
   insurers, and enterprises. Trust brands are nearly impossible to displace.
4. **Standard capture** — if the grade ladder becomes the vocabulary, we are the
   reference implementation.

## Business model

- **Open source, forever:** local optimization, the Proof Layer, the CLI. (Apache-2.0.)
- **Paid:** the fleet plane (org policies, scheduled runs, budgets, audit, SSO,
  self-hosting), production-confirmation integrations, the Proof API, long-term receipt
  history, support/SLA. Optional outcome-based pricing on verified savings.
- **Never:** reselling model tokens; charging for verification honesty.

## The milestone arc

1. First externally merged, verified improvement. *(The ignition. Everything above is
   fantasy until this happens and credible pitch after it.)*
2. Ten OSS repos optimized, public receipts in a gallery.
3. GitHub Action (`ci verify` + scheduled runs) in 100 repositories.
4. First cloud-cost customer with dollar-denominated receipts.
5. First Proof-API design partner (an agent company).
6. Fleet-plane enterprise pilot.
7. Publish the Verified Change Levels spec + the verified-outcome model leaderboard.

Two platform seeds are cheap enough to plant now, ahead of the arc:

- **Receipts as a stable, versioned, public schema** — the seed of the API and the
  standard.
- **Cost framing in reports** — "at N req/s, −87% latency ≈ $X/month less compute."
  Changes who can buy without changing what's built.

## What we will not claim (the honesty covenant)

The trust brand only works if it is literal. Carried forward from PLAN.md, permanently:

- Detection and reduction of reward hacking — never prevention of all of it.
- No statistical certainty small samples can't support; noise beats enthusiasm.
- Worktrees are isolation, not a sandbox; withheld cases are withheld, not hidden.
- Paxcli never merges or commits on its own. Ever.
- Budgets are soft caps and say so.

## Final rule (unchanged)

> Nothing here expands until Paxcli has produced a verified improvement that someone
> outside the team chooses to merge.

The external merge is not just a validation gate. It is rung 1 of the ladder, the first
receipt in the corpus, and the moment this document stops being speculative.
