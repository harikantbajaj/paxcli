# Plan: Simple Mode — `npx paxcli` → describe → done

Status: IMPLEMENTED (2026-08-15) — Phases 1–7 shipped with the recommended D1
(confirm-then-apply), D2 (authenticated-host detection, claude-code tie-break),
and D3 (Simple Mode patch-based; optimize engine unchanged). Phase 8 remains
future work. One deviation discovered during implementation: dependency/build
directories (node_modules, .venv, __pycache__) ARE excluded from snapshots
after all — worktrees reinstall dependencies, and snapshotting them lets
install artifacts masquerade as agent changes in repos without a .gitignore.
Follows PLAN.md (v4, shipped as 0.2.x).
Goal: `cd repo && npx paxcli`, one question ("What do you want to change?"), and
paxcli handles snapshot, isolation, agent, validation, and application — with no
`paxcli.config.json`, no manual commit, and no `--host` flag.

---

## Decisions to lock before building (recommendations included)

**D1 — Does paxcli write into the user's working directory?**
The original draft auto-applies the agent diff. That reverses the locked trust
rule ("paxcli never merges; the main tree is never touched") that is printed in
`paxcli apply` today.
**Recommendation:** keep one confirmation. After checks pass, show the changed
files + diffstat and ask `Apply to your working directory? (Y/n)`. `-y` /
non-interactive mode applies without asking. A recovery patch is written either
way. This preserves the trust story at the cost of one keypress.

**D2 — Host detection order.**
The draft says Codex first. PLAN.md locked Claude Code first (Codex = P1), and
both adapters now exist.
**Recommendation:** stop having a fixed favorite. Detect both; use whichever is
*installed and authenticated*; if both are, prefer `claude-code` (locked
decision) unless `paxcli.config.json` or `--host` says otherwise. Print
`Using Codex CLI 0.146.1` style line either way.

**D3 — Snapshot base for the existing optimize engine.**
Using the snapshot as base for *optimize* runs changes `apply`/winner-branch
semantics: a winner branch built on a snapshot commit would contain the user's
uncommitted work as history. **Recommendation:** Simple Mode is patch-based from
day one (no winner branches). Migrating the optimize engine onto snapshots is a
separate, later change (Phase 8) — until then `paxcli start` keeps requiring a
commit, which its error message already explains.

---

## Review verdict on the original draft (what changed and why)

Kept as-is:
- Snapshot via temporary index + `refs/paxcli/snapshots/<run-id>` (right
  mechanism; invisible to the user; solves "bench.py not committed").
- Separate general-task engine; **no parallel experiments** for subjective work.
- Honest labels: `Measured / Validated / Equivalent / Reproduced` reserved for
  benchmark-backed runs; task runs say "checks passed", never "better".
- Bounded repair loop (1 attempt + ≤2 repairs).
- Deferring auto-benchmark generation (agent-authored benchmark + agent-authored
  fix = reward-hacking surface).

Changed:
- Auto-apply → confirm-then-apply (D1).
- Codex-first → authenticated-host detection with claude-code tie-break (D2).
- Cut "detect the likely page/component for the request" from discovery. The
  coding agent explores the repo itself; paxcli guessing the target file adds
  code and a new failure mode for zero benefit. Discovery is only: package
  manager, validation commands, protected paths.
- Added everything the draft omitted: budget caps and timeouts for task runs,
  event-store integration (so `status`, `run list`, `gc`, `--json` work for task
  runs), mock-host test strategy, and the "repo has zero validation commands"
  case.

New risk called out:
- Excluding `.env`/secrets from the snapshot is the right default, but tests
  that need env vars will then fail *in the worktree* while passing locally.
  v1: detect this (validation failed + `.env` exists locally) and say so
  explicitly in the failure message. Opt-in env passthrough is out of scope.
- Positioning: a general task mode by itself is "Claude Code with extra steps".
  The sellable part is the wrapper: isolated execution, protected tests that
  cannot be silently weakened, honest labels, one-command recovery. README and
  output copy must lead with that, not with "paxcli writes features".

---

## Phase 1 — Snapshot layer (`src/snapshot/`)

`buildSnapshot(repoRoot) → { sha, ref, runId, fileCount }`

- Temporary index (`GIT_INDEX_FILE` env pointing into `.paxcli/tmp/`):
  `git add -A` (respects .gitignore) → `write-tree` → `commit-tree` (parent =
  HEAD if it exists) → `update-ref refs/paxcli/snapshots/<run-id>`.
- Captures: committed + staged + modified tracked + untracked files.
- Excludes on top of .gitignore: `.git/`, `.paxcli/`, `.env` and `.env.*`,
  `*.pem`/`*.key`/`id_rsa*`, `credentials*`. (Build outputs / node_modules are
  the repo's own .gitignore's job; do not second-guess it.)
- Unborn HEAD (repo with no commit): parentless snapshot commit; `git init`
  automatically if not a repo at all, after telling the user.
- User's index, branch, HEAD, stash, and working tree are never modified.
- `paxcli gc` also deletes `refs/paxcli/snapshots/*` (keep the latest N=5 or
  any referenced by a run with an unapplied result).
- Windows: reuse existing gotcha fixes — untrimmed porcelain parsing, blob-hash
  pins (CRLF), paths with spaces in every git invocation (already argv-array
  via execa, no shell interpolation).

Tests: dirty tracked file lands in snapshot; untracked lands; ignored and
`.env` do not; user index/HEAD byte-identical before/after; unborn-HEAD repo;
path with spaces.

## Phase 2 — Host auto-detection (`src/hosts/detect.ts`)

- `detectHosts() → ranked list` of `{ id, version, authenticated }`.
- Auth probes (installation alone isn't enough): `codex login status` for
  Codex; for Claude Code use the cheapest reliable signal (config/credentials
  presence, falling back to a 1-token `claude -p` ping only in `doctor`).
- Selection: config `host.id` > `--host` flag > first installed+authenticated
  (claude-code preferred on tie) > actionable error with the exact install +
  login commands (both adapters already have this copy).
- Wire into `doctor` so it reports both hosts.

## Phase 3 — Repo discovery (`src/discovery/repo.ts`)

Output: `{ packageManager, commands: { test?, lint?, typecheck?, build? },
protected: string[], language, notes[] }` — persisted to
`.paxcli/runs/<run-id>/discovery.json` so every run shows its evidence.

Sources, in priority order:
1. `paxcli.config.json` if present (gates/policy win outright — zero-config,
   not config-ignored).
2. `package.json` scripts (`test`, `lint`, `typecheck`, `build`) + lockfile →
   package manager.
3. Python: `manage.py` → `python manage.py test`; `pyproject.toml` →
   pytest/tooling sections.
4. CI workflows (`.github/workflows/*.yml`) as a cross-check for commands.

Skip placeholder scripts (`"test": "echo \"Error: no test specified\" && exit 1"`).
If nothing is found: proceed, but the result must say
`⚠ No validation commands found — changes were not tested by paxcli.`

Protected defaults for task mode: `.git/**`, `.paxcli/**`, `.env*`,
`.github/**`, `paxcli.config.json`, existing test files (existing tests may not
be modified; *new* test files are allowed and encouraged).

## Phase 4 — General task engine (`src/engine/task-loop.ts`)

Flow (reuses existing modules heavily):
1. Snapshot (Phase 1) → provision one worktree from the snapshot sha
   (existing `WorktreeBackend`).
2. `capturePins` on protected files (existing `src/proof/pins.ts`).
3. Build task prompt: user request + discovery summary + policy (what is
   protected, "add tests where reasonable, do not weaken existing ones").
4. One agent attempt via the existing `HostAdapter` (stdin prompt — keep the
   Windows lesson).
5. Engine-side checks (never the agent judging itself):
   - `verifyPins` — protected files untouched.
   - `runDetectors` (existing `src/proof/detectors.ts`) — test weakening,
     suspicious deletions.
   - Discovered commands via the existing gates engine, in order:
     typecheck → lint → test → build (skip missing ones).
6. On gate failure: feed the failing command + output tail back to the agent in
   the same worktree; ≤2 repair rounds; then fail honestly with the worktree
   path preserved for inspection.
7. Commit in the worktree (existing `Worktree.commit`) → hand to apply layer.

Guardrails the draft omitted: default budget cap (reuse `budget.maxCostUsd`
default $5; token fallback for Codex), per-attempt timeout (default 15 min),
Ctrl-C cleanup (`taskkill /T /F` path already exists), everything journaled to
the `EventStore` with a new run kind `task` so `status`, `run list`, `resume`,
`gc`, and `--json` keep working.

Result rendering (no Verification Card):
```
Done — <one-line summary from the agent>.

Changed:  <files>
Checks:   ✓ tests (python manage.py test) · ✓ build · — lint (none found)
Protected: ✓ existing tests unchanged
```

## Phase 5 — Apply layer (`src/apply/patch.ts`)

1. Diff = snapshot sha → accepted worktree commit.
2. Always write `.paxcli/runs/<run-id>/agent.patch` + keep the snapshot ref and
   an internal ref to the accepted commit (recovery works even if apply fails).
3. Preflight: `git apply --3way --check` against the user's *current* tree
   (3-way works because the snapshot tree supplies base blobs, including for
   files that were untracked at snapshot time).
4. Conflict (user edited the same lines mid-run): do not touch anything; keep
   the worktree; print the conflicting files and the patch path.
5. Clean: show diffstat, confirm per D1, `git apply --3way`. Working-tree only —
   never stages, never commits, never switches branches.

## Phase 6 — Bare-command UX (`src/cli/`)

- `npx paxcli` with no args → clack prompt (`@clack/prompts` is already a
  dependency): "What do you want to change?" → detection line → discovery
  summary (1–2 lines) → run. `--help`/`-V` unchanged; all existing subcommands
  unchanged.
- `npx paxcli "improve the form UI"` → same flow, non-interactive prompt input
  (commander: default argument that isn't a known subcommand).
- Routing: if the request smells like performance ("faster", "slow", "optimize",
  "latency", "memory") **and** a valid config with a benchmark exists → existing
  optimize engine. Otherwise task mode, and if it was perf-flavored, append:
  `Note: no benchmark configured — checks passed, but performance was not
  measured. Set one up to get verified numbers.`

## Phase 7 — Tests, docs, cross-platform

- All snapshot/apply invariants from Phase 1/5 as integration tests on real
  temp repos (pattern already exists in the suite).
- Engine flows tested with the mock host adapter (deterministic patches — the
  only sane way to test repair loops): prompt reaches the host verbatim; gate
  failure triggers exactly ≤2 repairs; subjective run output contains no
  Measured/Validated/Equivalent/Reproduced strings; conflicting user edit →
  nothing overwritten.
- Windows CI leg for snapshot + apply (spaces, CRLF).
- README: new 10-line top section — one command, what gets protected, what
  "checks passed" does and does not claim.

## Phase 8 (later) — snapshot base for the optimize engine

Move `start` onto snapshots too (kills its "commit first" requirement), which
requires switching optimize results from winner branches to the Phase 5 patch
flow. Separate change with its own review (D3).

Out of scope for this plan: auto-benchmark generation, visual/UI evaluation,
multi-agent comparison for subjective tasks, env passthrough into worktrees.

## Order and why

1 → 2 → 3 → 4 → 5 → 6 → 7. Snapshot first (everything sits on it), detection
and discovery next (small, independently testable), engine before UX (the
wizard is trivial once the engine exists), apply before the wizard ships
(a run you can't apply is a demo, not a product).
