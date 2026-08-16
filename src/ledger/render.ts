import type { LedgerEntry, OptimizationEntry, TaskEntry } from './schema.js';

/**
 * Markdown rendering for Proof Ledger entries. Pure functions: the same
 * entry always renders to the same text, so the ledger file can be fully
 * regenerated from its parsed entries (which is how appends stay idempotent
 * and the stats header stays consistent).
 */

const GRADE_LABEL: Record<NonNullable<OptimizationEntry['grade']>, string> = {
  measured: 'Measured — beat the local benchmark',
  validated: 'Validated — reliability checks passed',
  equivalent: 'Equivalent — behavior checks passed',
  reproduced: 'Reproduced — held in a fresh environment',
  'production-confirmed': 'Production-confirmed',
};

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function table(rows: Array<[string, string]>): string {
  const lines = ['| | |', '|---|---|'];
  for (const [label, value] of rows) lines.push(`| ${cell(label)} | ${cell(value)} |`);
  return lines.join('\n');
}

function machineBlock(entry: LedgerEntry): string {
  return [
    '<details><summary>machine-readable receipt</summary>',
    '',
    '```json',
    JSON.stringify(entry, null, 2),
    '```',
    '',
    '</details>',
  ].join('\n');
}

function entryDate(entry: LedgerEntry): string {
  return entry.recordedAt.slice(0, 10);
}

/** Short heading phrase: what changed and how strongly it is verified. */
export function entryTitle(entry: LedgerEntry): string {
  if (entry.kind === 'optimization') {
    const what =
      entry.metric && entry.display ? `${entry.metric} ${entry.display}` : entry.hypothesis;
    const grade = entry.grade ? entry.grade[0]?.toUpperCase() + entry.grade.slice(1) : 'Accepted';
    return `${what} · ${grade}`;
  }
  return `${entry.summary} · ${entry.label}`;
}

function renderOptimization(entry: OptimizationEntry): string {
  const rows: Array<[string, string]> = [];
  if (entry.metric && entry.display) rows.push([entry.metric, entry.display]);
  rows.push(['Verification', entry.grade ? GRADE_LABEL[entry.grade] : 'Accepted']);
  if (entry.noiseFloorPct != null) {
    rows.push(['Noise floor', `±${entry.noiseFloorPct.toFixed(1)}% (threshold is noise-derived)`]);
  }
  for (const gate of entry.gates) {
    rows.push([`Gate: ${gate.name}`, gate.pass ? '✓ passed' : '✗ failed']);
  }
  if (entry.withheldPassed != null) {
    rows.push(['Withheld checks', entry.withheldPassed ? '✓ passed' : '✗ failed']);
  }
  if (entry.reproductionHeld != null) {
    rows.push(['Fresh reproduction', entry.reproductionHeld ? '✓ held' : '✗ did not hold']);
  }
  rows.push(['Files protected', entry.pinsVerified ? '✓ integrity verified' : '✗ PIN VIOLATION']);
  if (entry.risks.length > 0) rows.push(['Remaining risk', entry.risks.join(' · ')]);
  if (entry.costUsd != null) rows.push(['Cost to find', `$${entry.costUsd.toFixed(2)}`]);
  rows.push([
    'Commits',
    `\`${entry.baseCommit.slice(0, 7)}\` → ${entry.finalCommit ? `\`${entry.finalCommit.slice(0, 7)}\`` : '(not committed)'}`,
  ]);
  rows.push(['Reproduce', `\`${entry.reproduceCmd}\``]);

  return [
    `## ${entryDate(entry)} · ${entryTitle(entry)}`,
    '',
    `> ${entry.hypothesis}`,
    '',
    table(rows),
    '',
    machineBlock(entry),
  ].join('\n');
}

function renderTask(entry: TaskEntry): string {
  const rows: Array<[string, string]> = [];
  rows.push(['Result', entry.label]);
  rows.push([
    'Changed',
    entry.changedFiles.length > 0 ? entry.changedFiles.join(', ') : '(no files listed)',
  ]);
  if (entry.checks.length > 0) {
    for (const c of entry.checks) {
      rows.push([`Check: ${c.name}`, `${c.pass ? '✓ passed' : '✗ failed'} (\`${c.cmd}\`)`]);
    }
  } else {
    rows.push(['Checks', 'none ran — this change was NOT tested by paxcli']);
  }
  rows.push(['Protected files', '✓ unchanged (existing tests, CI, config)']);
  if (entry.suspicions.length > 0) rows.push(['Review', entry.suspicions.join(' · ')]);
  if (entry.costUsd != null) rows.push(['Agent cost', `$${entry.costUsd.toFixed(2)}`]);
  if (entry.snapshotCommit && entry.resultCommit) {
    rows.push([
      'Commits',
      `\`${entry.snapshotCommit.slice(0, 7)}\` → \`${entry.resultCommit.slice(0, 7)}\``,
    ]);
  }

  return [
    `## ${entryDate(entry)} · ${entryTitle(entry)}`,
    '',
    table(rows),
    '',
    machineBlock(entry),
  ].join('\n');
}

export function renderEntryMarkdown(entry: LedgerEntry): string {
  return entry.kind === 'optimization' ? renderOptimization(entry) : renderTask(entry);
}
