# Paxcli Fleet dashboard

Paxcli Fleet is the zero-repository-footprint control plane for observing agents across many repositories. It separates the dashboard's state from customer source repositories: repository connections, policies, run events, approvals, and redacted outputs belong to the service, not the repository.

## Start the local control-plane MVP

```bash
paxcli dashboard --fleet --repo acme/payments-api acme/reporting-api
```

The process prints a tokenized loopback URL and binds only to `127.0.0.1`. Its store is memory-only. When the process stops, the dashboard state disappears. It never opens a connected repository for writing and never creates `.paxcli/`, `paxcli.config.json`, `PROOF.md`, receipts, logs, branches, or commits.

The command also prints an environment-only connection instruction. Set `PAXCLI_FLEET_URL` to the tokenized dashboard URL in another terminal, then run `paxcli start` in any repository. The run registers its repository and agent, streams redacted progress, and publishes its outcome automatically. `PAXCLI_REPOSITORY` can override the displayed repository name. No connection file is written.

This local mode proves the dashboard and ingestion contract. A production deployment should replace the memory store with an encrypted service database and execute work in ephemeral remote workers or customer-hosted runners.

## What users see

- All connected repositories and their latest activity
- Active agent, model, task, stage, elapsed work, and cost
- Agent-stated plans, hypotheses, next actions, and concise rationale
- Tools and files used, with sensitive values redacted before retention
- Benchmark samples, test/check results, rejected attempts, and final output
- Approval requests and reviewer decisions
- Verified outcomes across repositories

Paxcli does not publish hidden model chain-of-thought. The event contract carries user-legible plans, hypotheses, actions, evidence, and decisions—the information a reviewer can audit and act on.

## Control-plane model

The service models five resources:

1. Connected repositories
2. Repository policies and commands
3. Agent runs
4. Redacted activity events
5. Approval requests and decisions

Repository settings include benchmark, test and build commands, protected and writable paths, allowed agents, run budgets, retention, and PR-approval policy. These settings stay in the service and are not materialized into repository files.

## HTTP ingestion contract

The loopback service exposes authenticated endpoints for:

- Reading the complete dashboard snapshot
- Streaming updates through server-sent events
- Connecting and disconnecting repository metadata
- Updating service-side repository settings
- Creating and updating agent runs
- Appending plans, hypotheses, tool/file activity, checks, decisions, and outputs
- Requesting and deciding approvals

Every route requires the random session token. Mutations require an `application/json` request, enforce a small body limit, and redact sensitive text before it enters memory. The server rejects foreign Host headers, disables caching, prevents framing, and uses a restrictive content security policy.

## Production architecture

```text
GitHub App (read-only by default)
        ↓
Paxcli control plane
        ↓
Ephemeral remote worker or customer-hosted runner
        ↓
Agent → deterministic verification
        ↓ redacted events only
Fleet dashboard
        ↓ explicit approval
Optional branch and PR
```

Production requirements before hosting customer code:

- Read-only GitHub App permissions by default
- Separate, explicit permission for branches and pull requests
- Signed webhook verification and replay protection
- Encrypted connection credentials and run evidence
- Tenant isolation and per-run network isolation
- Redaction before events leave the worker
- Role-based repository access and complete audit history
- Configurable retention and immediate deletion
- Ephemeral worker destruction after every run
- A self-hosted runner for customers that cannot send source code to Paxcli

Connecting a repository is never permission to push, commit, open a PR, or merge. Those remain separate approval actions.

## Product rollout gate

Fleet is the paid control-plane direction, but broader enterprise work remains gated on single-repository validation: an external team must merge a verified Paxcli improvement, and at least one team must run Paxcli again without prompting. SSO, billing, scheduled fleets, and durable hosted storage should follow demonstrated repeat use.
