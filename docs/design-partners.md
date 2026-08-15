# Design-Partner Interviews (P0 exit gate)

Before heavy P1 work: **10 interviews · 3 external repositories offered · 2 users willing to run a supervised trial · one evidenced repeated pain · one chosen persona.**

Target profile: AI-native startup, 5–50 engineers, Node.js backend APIs, already using Claude Code, meaningful cloud bills, integration tests exist. Primary persona: **backend team lead**.

## The script

Warm-up
1. What was the last performance optimization your team actually shipped? Who found it, and how?
2. How long did it take from "something is slow" to merged fix?

Pain
3. How do you currently notice performance regressions — dashboards, complaints, cloud bill?
4. What performance work do you *know* should happen but never gets prioritized? Why?
5. Roughly what does a P95 latency problem cost you — in engineer-hours or infra spend?

Agents & trust
6. Do you let coding agents (Claude Code, Codex) write production code today? What evidence do you need before merging their PRs?
7. Which kinds of changes would you never let an agent make unattended?
8. If a tool handed you a PR with: before/after latency, noise bounds, test results, an equivalence check, and a reproduce command — what would still stop you from merging?

Fit
9. Would you run something like this weekly? On which repo? Who approves the budget?
10. What would a verified 15% P95 improvement on your hottest endpoint be worth to you?

## Log results

Track per interview: persona, repo offered (y/n), trial willingness (y/n), the quoted pain, the evidence bar for merging agent PRs. The P0 gate is not "10 conversations" — it is the evidence those conversations produce.
