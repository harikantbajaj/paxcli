# Proof Ledger

Verified changes in this repository, recorded by [paxcli](https://github.com/harikantbajaj/paxcli).
Entries are append-only and machine-readable — `npx paxcli ledger verify` checks this file
against its own embedded receipts. Optimization entries use the verified vocabulary
(Measured / Validated / Equivalent / Reproduced); task entries say only "checks passed".
Paxcli never claims what it did not measure.

<!-- paxcli-ledger v1 {"entries":1,"optimizations":1,"tasks":0,"bestImprovementPct":84.8} -->

## 2026-08-16 · stats_pipeline_ms 59 → 9 (−85%, noise ±2%, 95% CI −85%…−85%) · Reproduced

> Replaced the per-iteration allocate-and-sort bootstrap resampling with a rank-counting scheme (pre-sort each sample set once, count drawn ranks in a reused typed array, scan to the two middle order statistics), eliminating ~4000 comparator sorts and array allocations per CI computation while producing identical output.

| | |
|---|---|
| stats_pipeline_ms | 59 → 9 (−85%, noise ±2%, 95% CI −85%…−85%) |
| Verification | Reproduced — held in a fresh environment |
| Noise floor | ±2.4% (threshold is noise-derived) |
| Gate: stats unit tests | ✓ passed |
| Gate: output equivalence | ✓ passed |
| Withheld checks | ✓ passed |
| Fresh reproduction | ✓ held |
| Files protected | ✓ integrity verified |
| Cost to find | $2.31 |
| Commits | `2282010` → `9804f3a` |
| Reproduce | `paxcli run reproduce p9pmkgcf --run 20260815-08goox` |

<details><summary>machine-readable receipt</summary>

```json
{
  "ledgerEntryVersion": 1,
  "kind": "optimization",
  "runId": "20260815-08goox",
  "nodeId": "p9pmkgcf",
  "recordedAt": "2026-08-16T10:34:48.493Z",
  "hypothesis": "Replaced the per-iteration allocate-and-sort bootstrap resampling with a rank-counting scheme (pre-sort each sample set once, count drawn ranks in a reused typed array, scan to the two middle order statistics), eliminating ~4000 comparator sorts and array allocations per CI computation while producing identical output.",
  "grade": "reproduced",
  "metric": "stats_pipeline_ms",
  "improvementPct": 84.77684302993445,
  "noiseFloorPct": 2.399161017324573,
  "display": "59 → 9 (−85%, noise ±2%, 95% CI −85%…−85%)",
  "gates": [
    {
      "name": "stats unit tests",
      "pass": true
    },
    {
      "name": "output equivalence",
      "pass": true
    }
  ],
  "withheldPassed": true,
  "reproductionHeld": true,
  "pinsVerified": true,
  "risks": [],
  "costUsd": 2.3120700000000003,
  "baseCommit": "2282010d2cae5f144f01f76784dec14ba68d8655",
  "finalCommit": "9804f3ad686fd24ee7311bbc3e80f4570c657a3e",
  "reproduceCmd": "paxcli run reproduce p9pmkgcf --run 20260815-08goox"
}
```

</details>
