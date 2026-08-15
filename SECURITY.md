# Security Policy

## Reporting a vulnerability

Please email **harikant@processflows.ai** with details. Do not open a public issue for security reports. You will get a response within 72 hours.

## Scope and threat model — read this before running Paxcli

Paxcli orchestrates autonomous coding agents on your machine. Understand what is and is not enforced:

**Enforced by Paxcli**
- Agents receive a filtered environment (allowlist), never your full env.
- Protected files are integrity-pinned (git blob hashes) and verified before scoring, across the full experiment ancestry.
- Experiments run in isolated git worktrees; Paxcli's own git operations only touch `paxcli/*` namespaced refs.
- Per-agent timeouts; benchmark process supervision.

**Not enforced (current limitations, stated honestly)**
- There is no OS-level sandbox. Agents and benchmark commands run with your user account's permissions and can, in principle, read files outside the worktree or reach the network.
- Withheld/hidden test isolation is not yet implemented; gates live in the repository.
- Budget limits are checked before each agent spawn and can overshoot by one active agent call.

Do not run Paxcli on repositories or machines holding credentials you would not hand to a coding agent. Container-based isolation is on the roadmap (`BACKLOG.md`).

## Telemetry

None. This version of Paxcli sends no data anywhere.
