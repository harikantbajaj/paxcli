# Ascent — Product, CLI, Growth, and YC Review Points

Ascent is already technically ambitious. To make it more YC-attractive, do not simply make it bigger. Make it produce measurable user value faster, then expand around what users repeatedly need.

Do not describe the product publicly as an “Evo copy.” Position it as an independently built verified optimization platform inspired by the broader autoresearch category.

## 1. Make the startup story clearer

Use one simple statement:

> Ascent uses coding agents to find performance improvements and produces proof that each improvement is real, safe, and reproducible.

Avoid leading with:

- Tree search
- TypeScript
- Worktrees
- Host adapters
- Event sourcing
- “Better architecture than Evo”

Those explain how it works, not why customers care.

The commercial outcomes should be:

- Lower cloud bills
- Faster APIs
- Less engineering time spent profiling
- More performance improvements shipped
- Safer use of autonomous coding agents

## 2. Pick one exact initial customer

Do not target “all developers.”

Start with one ideal customer profile:

- AI-native startups with Node.js backend APIs
- 5–50 engineers
- Already using Claude Code
- Paying meaningful cloud infrastructure costs
- Maintaining integration tests
- Experiencing latency or scaling problems
- Comfortable reviewing agent-generated pull requests

This makes discovery, benchmarking, marketing, and sales much easier.

## 3. Narrow the first supported repository type

For the initial release, officially support something like:

> Node.js HTTP APIs using Fastify or Express, with Vitest/Jest tests and a reproducible local startup command.

Later add:

- NestJS
- Python/FastAPI
- Go services
- SQL-heavy applications
- LLM applications
- Frontend applications

Supporting one stack exceptionally well is more convincing than partially supporting every language.

## 4. Turn the Proof Layer into a visible product

Do not hide proof behind internal commands. Every result should have a prominent verification card containing:

- Improvement measured
- Confidence level
- Tests passed
- Output equivalence passed
- Withheld checks passed
- Fresh reproduction passed
- Files protected
- Cost of finding the improvement
- Exact base and final commits
- Remaining risks
- Human review required

Introduce verification levels:

- **Measured:** Faster in the initial benchmark.
- **Validated:** Reliability checks passed.
- **Equivalent:** Functional behavior checks passed.
- **Reproduced:** Result held in a fresh environment.
- **Production-confirmed:** Result held in CI, staging, or real traffic.

This prevents overclaiming and makes Ascent feel trustworthy.

## 5. Add production confirmation

Local benchmarks are helpful, but production evidence is much more valuable.

Eventually connect to:

- Datadog
- New Relic
- Grafana
- OpenTelemetry
- Sentry
- CloudWatch
- Prometheus

After a user merges an optimization, Ascent should compare:

- Before/after p50 and p95
- Error rate
- CPU
- Memory
- Throughput
- Infrastructure cost

Then update the experiment receipt with local, staging, and production results. This could become a major differentiator.

## 6. Improve automatic discovery

`ascent discover` should identify optimization opportunities rather than merely asking the user what to optimize.

Potential discovery sources:

- Slow integration tests
- CPU-heavy functions
- Repeated serialization
- N+1 database queries
- Duplicate network requests
- Blocking filesystem operations
- Large allocations
- Inefficient loops
- Missing caching
- Excessive logging
- Slow middleware
- Expensive dependency usage
- Existing profiling output
- Production tracing data

Rank suggestions by:

- Expected impact
- Confidence
- Measurement difficulty
- Safety
- Estimated agent cost
- Estimated engineering value

The user should choose what Ascent may attempt.

## 7. Add optimization recipes

Create built-in recipes for common problems:

- HTTP route latency
- JSON parsing
- Serialization
- Database-query count
- Memory allocation
- Startup time
- Test-suite time
- Event-processing throughput
- Cache effectiveness
- Queue-worker throughput

Each recipe should include:

- Discovery rules
- Benchmark template
- Recommended sample count
- Correctness gates
- Protected files
- Common reward-hacking checks
- Report presentation

Later allow community recipes, but review and sign official recipes.

## 8. Improve benchmark reliability

For serious credibility, add:

- Warm-up detection
- Minimum sample requirements
- Baseline/candidate interleaving
- Outlier reporting
- Machine-load detection
- CPU and memory monitoring
- Confidence intervals
- Effect-size calculation
- Flaky benchmark warnings
- Environment-drift detection
- Performance regression tolerance
- Separate cold-start and steady-state metrics
- Throughput-under-load measurement
- Candidate verification after system restart

Do not accept tiny improvements when benchmark noise is larger than the result.

## 9. Add multi-objective optimization

A faster implementation may consume more memory or reduce readability.

Support:

- Primary metric
- Hard constraints
- Secondary metrics
- User preferences

Example:

- Reduce p95 latency.
- Error rate must not rise.
- Memory cannot increase more than 10%.
- No additional runtime dependency.
- Public API cannot change.
- Complexity cannot increase dramatically.

Display tradeoffs rather than hiding them.

## 10. Strengthen reward-hacking protection

Add detection for:

- Modified benchmarks
- Modified fixtures
- Deleted or skipped tests
- Reduced assertions
- Hard-coded expected responses
- Detection of benchmark-specific inputs
- Clock manipulation
- Random-seed manipulation
- Caching that only works because of benchmark order
- Disabled validation
- Changed timeouts
- Changed test-runner configuration
- Modified dependency lockfiles
- Suppressed errors
- Reduced logging that hides failures
- External calls bypassing the real operation

Use a separate evaluator process and prevent implementation agents from controlling it.

Describe this honestly as detecting and reducing common reward-hacking techniques, not preventing every possible form of reward hacking.

## 11. Improve safety controls

Add visible permission profiles covering:

- Files the agent may read
- Files the agent may change
- Commands the agent may execute
- Environment variables it may receive
- Whether network access is allowed
- Whether dependency installation is allowed
- Maximum processes, memory, and disk usage
- Allowed domains
- Maximum duration and output size

Before running, show a permission summary such as:

> Ascent may modify `src/**`. It cannot modify tests, CI, deployment, or benchmark files. It may run `pnpm test` and `pnpm benchmark`. It cannot access production credentials.

Later add container execution for stronger isolation.

## 12. Improve the CLI structure

Organize commands into a simple hierarchy.

### Primary commands

- `ascent demo`
- `ascent start`
- `ascent resume`
- `ascent status`
- `ascent apply`
- `ascent doctor`

### Run management

- `ascent run list`
- `ascent run show`
- `ascent run explain`
- `ascent run compare`
- `ascent run cancel`
- `ascent run archive`
- `ascent run delete`
- `ascent run reproduce`
- `ascent run report`

### Benchmark management

- `ascent benchmark discover`
- `ascent benchmark validate`
- `ascent benchmark run`
- `ascent benchmark compare`
- `ascent benchmark explain-noise`

### Safety and policy

- `ascent policy show`
- `ascent policy audit`
- `ascent policy validate`
- `ascent policy permissions`
- `ascent secrets scan`

### Maintenance

- `ascent doctor`
- `ascent gc`
- `ascent repair`
- `ascent upgrade`
- `ascent completion`
- `ascent config validate`

### Automation

- `ascent ci verify`
- `ascent ci optimize`
- `ascent pr`
- `ascent export`
- `ascent import`

Keep advanced commands away from the beginner workflow.

## 13. Add useful CLI presets

Provide outcome-oriented presets:

- `quick` — two low-cost experiments
- `balanced` — normal development run
- `deep` — longer autonomous search
- `overnight` — deadline- and budget-constrained
- `ci` — deterministic and non-interactive
- `safe` — no network or dependency changes
- `explore` — more diverse hypotheses
- `verify-only` — verify an existing branch

Show exactly what a preset means before execution.

## 14. Make terminal output excellent

The terminal should show:

- Current stage
- Current hypothesis
- Active experiments
- Cost so far
- Estimated time remaining
- Baseline and best score
- Gate results
- Rejected-reason summary
- Confidence level
- Safe Ctrl-C behavior
- Resume command

Example statuses:

- “Measuring baseline stability”
- “Testing response-cache hypothesis”
- “Rejected: increased memory by 17%”
- “Reproducing the current winner”
- “Accepted: p95 improved 14%, all equivalence checks passed”

Avoid displaying raw agent logs unless `--verbose` is enabled.

When `--json` is enabled, reserve stdout for stable machine-readable JSON and send progress or diagnostics to stderr.

## 15. Add comparison and explanation features

For every experiment, explain:

- What the agent attempted
- Why it expected improvement
- Which files changed
- Why performance changed
- Why it was accepted or rejected
- What risks remain
- What a reviewer should inspect
- Whether the technique is broadly applicable

Allow comparison of two nodes by:

- Score
- Memory
- Cost
- Diff size
- Gates
- Confidence
- Dependencies
- Complexity
- Agent explanation

## 16. Make the dashboard decision-oriented

Prioritize:

- Current winner
- Verification grade
- Cost
- Improvement
- Remaining risk
- Apply/reject decision

Later add:

- Experiment tree
- Score-versus-cost chart
- Latency/memory Pareto chart
- Node comparison
- Diff viewer
- Live logs
- Gate history
- Benchmark distribution
- Timeline replay
- Research journal
- Search and filters
- Run comparison
- Production-confirmation status

Do not make the tree visualization the main product. The verified result is the product.

## 17. Add a research journal

After every round, generate a concise journal covering:

- What was attempted
- What worked
- What failed
- Common failure patterns
- New understanding of the codebase
- Recommended next experiments
- Remaining bottlenecks

This gives users value even when no experiment wins.

## 18. Add human steering

Users should be able to send instructions while a run is active:

- “Do not add caching.”
- “Focus on database calls.”
- “Avoid new dependencies.”
- “Stop exploring serialization.”
- “Use at most 1 GB of memory.”
- “Branch from experiment 12.”
- “Verify experiment 8 again.”

Record steering instructions in the receipt and audit log.

## 19. Add model and agent comparison later

Allow users to compare:

- Claude models
- Codex models
- Different prompts
- Researcher/executor combinations
- Cost versus success rate
- Speed versus quality

Ascent could eventually explain which model is most cost-effective for discovery, implementation, and review in a particular repository.

## 20. Add GitHub integration early

Useful behaviors:

- Comment `@ascent optimize this endpoint`.
- Apply an `ascent-optimize` label.
- Run on a schedule.
- Run after a performance regression.
- Open a PR with the receipt.
- Post benchmark evidence as a check.
- Request approval before expensive runs.
- Reverify when the base branch changes.
- Close or update stale optimization PRs.

Every PR should contain:

- Before/after metrics
- Confidence
- Gates
- Cost
- Reproduction command
- Verification level
- Risks
- “Verified by Ascent” footer

## 21. Add CI and regression prevention

After Ascent finds an improvement, it should help preserve it.

Create:

- Performance-budget checks
- Baseline snapshots
- Regression alerts
- Scheduled verification
- Automatic issue creation
- Suggested repair runs
- Performance history by branch

This changes Ascent from a one-time optimizer into a continuously useful product.

## 22. Build growth loops

Useful organic growth mechanisms:

- Shareable redacted experiment reports
- GitHub PR footer
- Repository performance badge
- Public optimization gallery
- Open-source repository optimization program
- Community benchmark challenges
- Official optimization recipes
- “Optimize this repository” action
- Monthly verified-savings report
- Attribution for community recipe authors

Optimize popular open-source repositories and submit legitimate upstream PRs. Merged external PRs are powerful product evidence.

## 23. Make the product enjoyable

Add optional professional “fun” elements:

- Human-readable experiment names
- Animated experiment tree
- Research-session replay
- Before/after performance cards
- Milestone notifications
- Dark/light terminal themes
- Desktop notification when a winner is found
- “Overnight research completed” summary
- Repository improvement history
- Personal and team achievement summaries

Celebrate verified wins rather than the number of agents or tokens used.

## 24. Design the commercial product

Keep local optimization open source.

Charge for:

- GitHub organization integration
- Scheduled runs
- Shared team dashboard
- Remote workers
- Centralized budgets
- Approval workflows
- Organization policies
- Audit logs
- SSO
- Private networking
- Production-monitoring integrations
- Long-term experiment history
- Support and SLA
- Self-hosted control plane

Do not rely on reselling model tokens.

## 25. Improve YC attractiveness

YC will care about evidence such as:

- Number of external repositories tested
- Number of verified candidates
- Number of PRs merged
- Percentage of users who run Ascent again
- Engineering hours saved
- Infrastructure cost reduced
- Cost of producing each accepted result
- How quickly user feedback becomes product improvement
- Why existing tools do not solve the problem

Strong early milestones:

1. Ten customer interviews.
2. Three external repositories.
3. First externally merged optimization.
4. Five merged optimization PRs.
5. One customer uses Ascent twice.
6. First user pays.
7. First production-confirmed improvement.

## 26. Create a strong YC demo

The demo should show:

1. A real external backend repository.
2. One command.
3. Ascent identifies a slow endpoint.
4. Several approaches are tested.
5. A tempting but incorrect optimization is rejected.
6. A correct optimization improves latency.
7. The result reproduces in a fresh environment.
8. Ascent opens a clear PR.
9. The repository owner merges it.
10. Production metrics later confirm the improvement.

That is more compelling than demonstrating dozens of commands.

## 27. Avoid these traps

- Building cloud backends before users want them
- Supporting every language
- Spending months on the dashboard
- Claiming a perfect security sandbox
- Claiming statistical certainty from small samples
- Calling withheld files completely secret without enforced isolation
- Running expensive searches without user-visible budgets
- Optimizing synthetic demos only
- Measuring stars instead of retained users
- Creating a plugin marketplace before third parties ask for it
- Copying Evo’s terminology, documentation, or visual identity
- Treating generated code as safe merely because tests passed
- Automatically merging changes
- Adding features without evidence users need them

## 28. Recommended priority order

### P0 — Prove the concept

- One supported backend stack
- Reliable benchmark lifecycle
- Output equivalence
- Minimum Proof Layer
- Claude adapter
- Worktree isolation
- Cost and time limits
- Reproducible receipt
- Excellent demo
- One external merged improvement

### P1 — Make people return

- Resume and crash recovery
- Full Proof Layer
- Research journal
- Better discovery
- Comparison and explanation
- GitHub PR generation
- Codex adapter
- Simple dashboard
- Five design partners

### P2 — Create distribution

- GitHub App
- CI checks
- Scheduled optimization
- Performance badges
- Shareable reports
- Open-source optimization campaign
- Production-monitoring integrations

### P3 — Build the company

- Team dashboard
- Remote execution
- Organization policies
- SSO and audit
- Optimization packs
- Paid pilots
- Enterprise self-hosting

## Final rule

> Do not build more functionality until Ascent has produced a verified improvement that someone outside the team chooses to merge.

That external merge is the first real proof that the product—not merely the architecture—is valuable.
