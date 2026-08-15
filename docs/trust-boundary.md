# Trust Boundary

What Paxcli enforces, what enforces it, and what is **not** enforced. No security theater: if a control is best-effort, it says so here and in the product.

| Capability | Enforced by | Status |
|---|---|---|
| Environment filtering (allowlist; agents never see your full env) | Paxcli process launcher (`src/policy/env.ts`) | Enforced |
| Protected-file integrity | git blob pins + status inspection, before scoring | Enforced |
| Experiment isolation from your working tree | git worktrees; only `paxcli/*` refs touched | Enforced |
| Agent/benchmark timeouts | process supervisor | Enforced |
| Main-repo drift detection | snapshot at run start; warn, never blame | Enforced |
| Budget ceiling | checked before each agent spawn | **Soft** — can overshoot by one active agent call, and the UI says so |
| Agent filesystem boundary | — | **Not enforced.** Agents run with your user permissions and can read outside the worktree |
| Network policy for agents/benchmarks | — | **Not enforced** (the Claude process necessarily reaches its API) |
| Withheld evaluator cases | kept in `.paxcli/withheld/` (gitignored → absent from worktrees); agents receive only failure categories | **Partial** — out of the loop, not process-isolated: a local agent could in principle read the directory. Called "withheld", never "hidden" |
| Receipt redaction | secret scanning; reports/PRs use redacted variants only | Enforced (pattern-based — review before sharing highly sensitive repos) |
| Reward-hack detectors | static diff analysis (skips, timing patches, lockfiles) | Enforced as one layer — detects and reduces, does not prevent all manipulation |

## Practical guidance

- Run Paxcli on repositories you would let a coding agent read in full.
- Keep production credentials out of the shell you run it from; the env allowlist reduces exposure, it does not virtualize the filesystem.
- Review the winner diff before merging. Always. The product is built around that step.

Container-backed isolation is planned (BACKLOG.md, P3). Until it exists, Paxcli will not describe itself as sandboxed.
