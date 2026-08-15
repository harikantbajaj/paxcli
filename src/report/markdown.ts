import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Receipt } from '../proof/receipt.js';
import { redactText } from '../proof/redact.js';
import type { RunSummary } from '../tree/types.js';
import { improvementPct } from '../tree/types.js';

/**
 * Shareable run report (always built from REDACTED receipts). This is the
 * artifact that goes into a PR description, a Slack message, or an issue.
 */
export async function buildRunReport(params: {
  summary: RunSummary;
  receiptsDir: string;
}): Promise<string> {
  const { summary, receiptsDir } = params;
  const receipts = await loadRedactedReceipts(receiptsDir);
  const best = summary.bestNodeId ? summary.nodes.get(summary.bestNodeId) : null;

  const lines: string[] = [
    `# paxcli run report — ${summary.runId}`,
    '',
    `- State: ${summary.finished ? `finished (${summary.finishReason})` : 'in progress / interrupted'}`,
    `- Experiments: ${summary.nodes.size} · Agent cost: $${summary.totalCostUsd.toFixed(2)}`,
  ];
  if (summary.baseline) {
    lines.push(
      `- Baseline: ${summary.baseline.metric} = ${summary.baseline.value.toFixed(2)} (noise ±${(summary.noiseFloorPct ?? 0).toFixed(1)}%)`,
    );
  }
  lines.push('');

  if (best?.score && summary.baseline) {
    const pct = improvementPct(best.score.value, summary.baseline.value, best.score.direction);
    const bestReceipt = receipts.find((r) => r.nodeId === best.id);
    lines.push(
      '## Verified winner',
      '',
      `**${redactText(best.hypothesis)}**`,
      '',
      `- Improvement: ${pct.toFixed(1)}% (${bestReceipt?.comparison?.display ?? ''})`,
      `- Verification grade: **${best.grade ?? 'measured'}**`,
      `- Gates: ${bestReceipt?.gates.map((g) => `${g.name} ${g.pass ? '✓' : '✗'}`).join(' · ') ?? 'n/a'}`,
      bestReceipt?.withheld?.configured
        ? `- Withheld behavior checks: ${bestReceipt.withheld.pass ? '✓ passed' : `✗ failed (${bestReceipt.withheld.category})`}`
        : '',
      bestReceipt?.reproduction
        ? `- Fresh reproduction: ${bestReceipt.reproduction.held ? '✓ held' : '✗ did not hold'} (${bestReceipt.reproduction.display})`
        : '',
      bestReceipt?.risks.length
        ? `- Remaining risks for review: ${bestReceipt.risks.join('; ')}`
        : '',
      `- Commits: \`${bestReceipt?.baseCommit.slice(0, 7)}\` → \`${bestReceipt?.finalCommit?.slice(0, 7)}\``,
      `- Reproduce locally: \`${bestReceipt?.reproduceCmd}\``,
      '',
    );
  } else {
    lines.push('## No verified improvement this run', '');
  }

  lines.push('## All experiments', '');
  for (const node of summary.nodes.values()) {
    const mark = node.status === 'accepted' ? '✓' : node.status === 'failed' ? '⚠' : '✗';
    lines.push(
      `- ${mark} ${redactText(node.hypothesis || '(no hypothesis)')} — ${redactText(node.decisionReason ?? node.status)}`,
    );
  }
  lines.push(
    '',
    '---',
    '_Verified by [paxcli](https://github.com/harikantbajaj/paxcli): agents propose, a deterministic evaluator decides._',
  );
  return lines
    .filter((l) => l !== '')
    .join('\n')
    .replace(/\n(#)/g, '\n\n$1');
}

async function loadRedactedReceipts(receiptsDir: string): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  let files: string[] = [];
  try {
    files = await readdir(receiptsDir);
  } catch {
    return receipts;
  }
  for (const f of files) {
    if (!f.endsWith('.redacted.json')) continue;
    try {
      receipts.push(JSON.parse(await readFile(path.join(receiptsDir, f), 'utf8')) as Receipt);
    } catch {
      // skip unreadable receipt
    }
  }
  return receipts;
}

export async function writeRunReport(runDirPath: string, content: string): Promise<string> {
  const file = path.join(runDirPath, 'report.md');
  await writeFile(file, content, 'utf8');
  return file;
}
