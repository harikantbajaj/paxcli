# Contributing to Paxcli

Thanks for helping build verified autonomous optimization. A few things make this codebase unusual — please read before your first PR.

## Ground rules

1. **The evaluator stays deterministic.** No agent may ever decide whether its own (or another agent's) work is accepted. Acceptance logic lives in `src/engine/run-loop.ts` and its helpers, and it is plain code.
2. **Honesty over polish.** Never display precision the statistics don't support, never call a defense "prevention" when it is detection, never claim isolation we don't enforce. If your feature can overclaim, its output must underclaim.
3. **Windows is a first-class platform.** CI runs on Windows/macOS/Linux; worktree and process code must handle Windows quirks (EBUSY on removal, PID reuse, CRLF normalization — see `src/proof/pins.ts` for why pins use git blob hashes).
4. **No native dependencies.** `npx paxcli` must work on a cold machine without build tools.

## Getting started

```bash
npm install
npm run check        # typecheck + lint + tests (includes the e2e demo, ~1 min)
node dist/cli.js demo
```

## Good first contributions

- **Codex CLI host adapter**: implement `HostAdapter` (4 methods) in `src/hosts/codex/`, modeled on `src/hosts/claude-code/adapter.ts`, parsing `codex exec --json` output.
- **Reward-hack detectors**: new checks in `src/proof/` (skipped-test detection, timing manipulation, lockfile changes) — each needs an adversarial test in the style of `src/proof/pins.test.ts`.
- **Statistics**: paired interleaved baseline/candidate sampling in `src/bench/`.
- See `BACKLOG.md` for the prioritized list.

## Pull requests

- Add tests. Proof-layer changes require adversarial tests (show the attack, show it caught).
- `npm run check` must pass.
- One logical change per PR; explain *why* in the description.

## Legal

By contributing you agree your contributions are licensed under Apache-2.0. Do not copy code, text, or assets from other optimization tools.
