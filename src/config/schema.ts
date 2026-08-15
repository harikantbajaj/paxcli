import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * paxcli.config.json — the single source of truth for a repository's
 * optimization target, benchmark lifecycle, gates, constraints, and policy.
 */

export const gateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Shell command; exit 0 = pass. */
  cmd: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().default(300_000),
  kind: z.enum(['tests', 'invariant', 'equivalence', 'custom']).default('custom'),
});

export const serverSchema = z.object({
  /** Command that starts the app. Receives a free port as env PORT. */
  startCmd: z.string().min(1),
  /** URL polled until it responds 2xx before sampling begins. Supports {port}. */
  readyUrl: z.string().min(1),
  readyTimeoutMs: z.number().int().positive().default(30_000),
});

export const benchmarkSchema = z.object({
  /**
   * Command that measures once and prints a JSON line to stdout:
   *   {"metric": "p95_latency_ms", "value": 123.4, "secondary": {"memory_mb": 87}}
   * Receives env PORT/TARGET_URL when `server` is configured.
   */
  sampleCmd: z.string().min(1),
  /** Optional app under test; the harness owns its lifecycle when present. */
  server: serverSchema.optional(),
  /** Optional one-time setup (fixtures, build) run before sampling begins. */
  setupCmd: z.string().optional(),
  /** Optional reset between samples (clear caches, reset DB state). */
  resetCmd: z.string().optional(),
  metric: z.string().min(1),
  direction: z.enum(['minimize', 'maximize']),
  warmupSamples: z.number().int().min(0).default(2),
  /** Samples per measurement pass. p95 is refused below 20 observations. */
  samples: z.number().int().min(3).default(8),
  sampleTimeoutMs: z.number().int().positive().default(120_000),
  /**
   * Maximum baseline noise (coefficient of variation, %) before the run
   * refuses to optimize. Raise only on known-noisy hardware (shared CI);
   * the acceptance threshold still scales with the noise actually measured.
   */
  maxNoisePct: z.number().positive().default(10),
});

export const constraintSchema = z.object({
  /** Name of a secondary measurement reported by the benchmark. */
  metric: z.string().min(1),
  /** Maximum allowed increase relative to baseline, in percent. */
  maxIncreasePct: z.number().nonnegative(),
});

export const policySchema = z.object({
  level: z.enum(['sandboxed', 'standard', 'trusted']).default('standard'),
  /** Globs the agent may modify. Everything else is protected by default. */
  writable: z.array(z.string()).default(['src/**']),
  /** Files whose integrity is pinned; edits reject the experiment. */
  protected: z
    .array(z.string())
    .default(['paxcli.config.json', 'test/**', 'tests/**', '.github/**']),
  /** Environment variable names passed through to agents (never the full env). */
  envAllowlist: z
    .array(z.string())
    .default([
      'PATH',
      'HOME',
      'USERPROFILE',
      'TEMP',
      'TMP',
      'SYSTEMROOT',
      'COMSPEC',
      'NODE_OPTIONS',
    ]),
  allowDependencyChanges: z.boolean().default(false),
});

export const paxcliConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1).default(1),
  benchmark: benchmarkSchema,
  gates: z.array(gateSchema).default([]),
  constraints: z.array(constraintSchema).default([]),
  policy: policySchema.default({}),
  /**
   * Withheld evaluator cases: a command run by the ENGINE (cwd = main repo,
   * not the worktree) with env TARGET_DIR (the experiment checkout) and
   * WITHHELD_DIR (.paxcli/withheld, gitignored so worktrees never contain
   * it). Exit 0 = behavior holds. On failure only a `CATEGORY: <slug>` line
   * is shared with agents.
   */
  withheld: z
    .object({
      cmd: z.string().min(1),
      timeoutMs: z.number().int().positive().default(300_000),
    })
    .optional(),
  search: z
    .object({
      maxRounds: z.number().int().positive().default(3),
      parallel: z.number().int().min(1).max(8).default(2),
      maxNodes: z.number().int().positive().default(12),
      plateauRounds: z.number().int().positive().default(2),
      /** Reject wins smaller than max(noise floor, this) percent. */
      minImprovementPct: z.number().nonnegative().default(1),
      /** Parent selection: always extend the best, or explore with probability epsilon. */
      strategy: z.enum(['best-first', 'epsilon-greedy']).default('best-first'),
      epsilon: z.number().min(0).max(1).default(0.2),
      /**
       * Agent roles per experiment: 'single' (one agent forms and implements
       * the hypothesis) or 'split' (a researcher proposes, an executor
       * implements). The evaluator is deterministic engine code either way.
       */
      roles: z.enum(['single', 'split']).default('single'),
      /** Re-verify the winner in a fresh worktree after the loop (grade: reproduced). */
      reproduceWinner: z.boolean().default(true),
    })
    .default({}),
  budget: z
    .object({
      maxCostUsd: z.number().positive().default(5),
      maxWallClockMs: z
        .number()
        .int()
        .positive()
        .default(60 * 60 * 1000),
      perAgentTimeoutMs: z
        .number()
        .int()
        .positive()
        .default(15 * 60 * 1000),
    })
    .default({}),
  host: z
    .object({
      id: z.enum(['claude-code', 'codex', 'mock']).default('claude-code'),
      model: z.string().optional(),
    })
    .default({}),
});

export type PaxcliConfig = z.infer<typeof paxcliConfigSchema>;
export type GateConfig = z.infer<typeof gateSchema>;
export type BenchmarkConfig = z.infer<typeof benchmarkSchema>;
export type PolicyConfig = z.infer<typeof policySchema>;

export const CONFIG_FILENAME = 'paxcli.config.json';

export async function loadConfig(repoRoot: string): Promise<PaxcliConfig> {
  const file = path.join(repoRoot, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(
      `No ${CONFIG_FILENAME} found in ${repoRoot}. Run \`paxcli start\` for guided setup.`,
    );
  }
  return parseConfig(raw, file);
}

export function parseConfig(raw: string, sourceLabel = CONFIG_FILENAME): PaxcliConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${sourceLabel} is not valid JSON: ${(err as Error).message}`);
  }
  const result = paxcliConfigSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${sourceLabel} failed validation:\n${issues}`);
  }
  return result.data;
}

export function configHash(config: PaxcliConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16);
}
