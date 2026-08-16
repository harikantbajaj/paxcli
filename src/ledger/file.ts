import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gitOutput } from '../worktree/local.js';
import { renderEntryMarkdown } from './render.js';
import { type LedgerEntry, entryKey, ledgerEntrySchema } from './schema.js';

/**
 * Proof Ledger file lifecycle. The file is regenerated from its parsed
 * entries on every append: idempotent by entry key, stats header always
 * consistent, and `verifyLedger` can hold the file to its own claims.
 *
 * Ledger writes are working-tree only and best-effort — a ledger failure
 * must never fail the command that produced the verified result.
 */

export const LEDGER_VERSION = 1;
export const LEDGER_DEFAULT_PATH = 'PROOF.md';

export interface LedgerStats {
  entries: number;
  optimizations: number;
  tasks: number;
  bestImprovementPct: number | null;
}

export interface ParsedLedger {
  entries: LedgerEntry[];
  /** Raw stats object from the header comment, if present and parseable. */
  statedStats: LedgerStats | null;
  /** Malformed blocks or invalid entries found while parsing. */
  problems: string[];
}

const STATS_RE = /^<!-- paxcli-ledger v(\d+) (\{.*\}) -->$/m;
const JSON_BLOCK_RE = /^```json\r?\n([\s\S]*?)\r?\n```$/gm;

const HEADER = `# Proof Ledger

Verified changes in this repository, recorded by [paxcli](https://github.com/harikantbajaj/paxcli).
Entries are append-only and machine-readable — \`npx paxcli ledger verify\` checks this file
against its own embedded receipts. Optimization entries use the verified vocabulary
(Measured / Validated / Equivalent / Reproduced); task entries say only "checks passed".
Paxcli never claims what it did not measure.`;

export function computeStats(entries: LedgerEntry[]): LedgerStats {
  const optimizations = entries.filter((e) => e.kind === 'optimization');
  let best: number | null = null;
  for (const e of optimizations) {
    if (e.improvementPct != null && (best === null || e.improvementPct > best)) {
      best = e.improvementPct;
    }
  }
  return {
    entries: entries.length,
    optimizations: optimizations.length,
    tasks: entries.length - optimizations.length,
    bestImprovementPct: best != null ? Number(best.toFixed(1)) : null,
  };
}

export function renderLedger(entries: LedgerEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const stats = computeStats(sorted);
  const parts = [
    HEADER,
    '',
    `<!-- paxcli-ledger v${LEDGER_VERSION} ${JSON.stringify(stats)} -->`,
    '',
    ...sorted.map((e) => `${renderEntryMarkdown(e)}\n`),
  ];
  return `${parts.join('\n').trimEnd()}\n`;
}

export function parseLedger(content: string): ParsedLedger {
  const problems: string[] = [];
  let statedStats: LedgerStats | null = null;

  const statsMatch = content.match(STATS_RE);
  if (statsMatch?.[2]) {
    try {
      statedStats = JSON.parse(statsMatch[2]) as LedgerStats;
    } catch {
      problems.push('stats header comment is not valid JSON');
    }
  }

  const entries: LedgerEntry[] = [];
  for (const match of content.matchAll(JSON_BLOCK_RE)) {
    const block = match[1] ?? '';
    let json: unknown;
    try {
      json = JSON.parse(block);
    } catch {
      problems.push(`entry block is not valid JSON: ${block.slice(0, 60)}…`);
      continue;
    }
    const parsed = ledgerEntrySchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push(
        `invalid entry (${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'unknown'})`,
      );
      continue;
    }
    entries.push(parsed.data);
  }
  return { entries, statedStats, problems };
}

export interface AppendResult {
  file: string;
  /** False when the entry was already recorded (idempotent re-apply). */
  added: boolean;
  entryCount: number;
}

export async function appendLedgerEntry(params: {
  repoRoot: string;
  entry: LedgerEntry;
  ledgerPath?: string;
}): Promise<AppendResult> {
  const file = path.join(params.repoRoot, params.ledgerPath ?? LEDGER_DEFAULT_PATH);
  let existing: LedgerEntry[] = [];
  try {
    const content = await readFile(file, 'utf8');
    const parsed = parseLedger(content);
    if (parsed.problems.length > 0) {
      throw new Error(
        `${path.basename(file)} has invalid entries (${parsed.problems[0]}). Fix or remove it, then re-run.`,
      );
    }
    existing = parsed.entries;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const key = entryKey(params.entry);
  if (existing.some((e) => entryKey(e) === key)) {
    return { file, added: false, entryCount: existing.length };
  }
  const entries = [...existing, params.entry];
  await writeFile(file, renderLedger(entries), 'utf8');
  return { file, added: true, entryCount: entries.length };
}

export interface VerifyResult {
  ok: boolean;
  /** Hard failures: malformed entries, stats drift, duplicates. */
  errors: string[];
  /** Soft findings: commits no longer present locally (gc, rebase, shallow clone). */
  warnings: string[];
  stats: LedgerStats | null;
}

export async function verifyLedger(params: {
  repoRoot: string;
  ledgerPath?: string;
}): Promise<VerifyResult> {
  const file = path.join(params.repoRoot, params.ledgerPath ?? LEDGER_DEFAULT_PATH);
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch {
    return {
      ok: false,
      errors: [`no ledger found at ${file}`],
      warnings: [],
      stats: null,
    };
  }

  const parsed = parseLedger(content);
  const errors = [...parsed.problems];
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const entry of parsed.entries) {
    const key = entryKey(entry);
    if (seen.has(key)) errors.push(`duplicate entry: ${key}`);
    seen.add(key);
  }

  const actual = computeStats(parsed.entries);
  if (parsed.statedStats === null) {
    errors.push('stats header comment is missing');
  } else if (JSON.stringify(parsed.statedStats) !== JSON.stringify(actual)) {
    errors.push(
      `stats header does not match entries (stated ${JSON.stringify(parsed.statedStats)}, actual ${JSON.stringify(actual)})`,
    );
  }

  for (const entry of parsed.entries) {
    const commits =
      entry.kind === 'optimization'
        ? [entry.baseCommit, entry.finalCommit]
        : [entry.snapshotCommit, entry.resultCommit];
    for (const sha of commits) {
      if (!sha) continue;
      try {
        await gitOutput(params.repoRoot, ['cat-file', '-e', `${sha}^{commit}`]);
      } catch {
        warnings.push(
          `${entryKey(entry)}: commit ${sha.slice(0, 7)} not found locally (may be gc'd or unfetched)`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats: actual };
}
