import { existsSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExperimentNode, Score } from '../tree/types.js';
import { improvementPct } from '../tree/types.js';

/**
 * Research journal: a deterministic, human-readable record of what each round
 * attempted and learned. Useful even when no experiment wins — the rejected
 * hypotheses ARE the research.
 */
export async function appendJournalRound(params: {
  runDir: string;
  runId: string;
  round: number;
  roundNodes: ExperimentNode[];
  best: ExperimentNode | null;
  baseline: Score | null;
  totalCostUsd: number;
}): Promise<string> {
  const { runDir, runId, round, roundNodes, best, baseline, totalCostUsd } = params;
  const file = path.join(runDir, 'journal.md');
  if (!existsSync(file)) {
    await writeFile(file, `# Research journal — run ${runId}\n`, 'utf8');
  }
  const lines: string[] = [`\n## Round ${round}\n`];
  for (const n of roundNodes) {
    const mark = n.status === 'accepted' ? '✔' : n.status === 'failed' ? '⚠' : '✘';
    lines.push(
      `- ${mark} **${n.hypothesis || '(no hypothesis)'}** — ${n.decisionReason ?? n.status}`,
    );
  }
  if (best?.score && baseline) {
    const pct = improvementPct(best.score.value, baseline.value, best.score.direction);
    lines.push(
      `\nBest so far: ${best.hypothesis} (${pct.toFixed(1)}% vs baseline). Cost to date: $${totalCostUsd.toFixed(2)}.`,
    );
  } else {
    lines.push(`\nNo accepted improvement yet. Cost to date: $${totalCostUsd.toFixed(2)}.`);
  }
  const rejectedPatterns = roundNodes
    .filter((n) => n.status === 'rejected')
    .map((n) => n.decisionReason ?? '')
    .filter((r) => r.length > 0);
  if (rejectedPatterns.length > 0) {
    lines.push('\nWhat this round ruled out:');
    for (const r of rejectedPatterns) lines.push(`- ${r}`);
  }
  await appendFile(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}
