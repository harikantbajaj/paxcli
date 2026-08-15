import pc from 'picocolors';
import type { Receipt } from '../proof/receipt.js';

/** Renders the Verification Card — the product's face in the terminal. */
export function renderVerificationCard(receipt: Receipt): string {
  const rows: Array<[string, string]> = [];

  if (receipt.comparison && receipt.baseline && receipt.candidate) {
    rows.push([receipt.baseline.metric, receipt.comparison.display]);
  }
  rows.push(['Verification', gradeLabel(receipt.grade)]);
  if (receipt.comparison) {
    rows.push([
      'Threshold',
      `improvement must exceed ${receipt.comparison.requiredPct.toFixed(1)}% (noise-derived)`,
    ]);
  }
  for (const gate of receipt.gates) {
    rows.push([
      `Gate: ${gate.name}`,
      gate.pass ? pass('passed') : fail(`failed (exit ${gate.exitCode ?? '?'})`),
    ]);
  }
  if (receipt.withheld?.configured) {
    rows.push([
      'Withheld checks',
      receipt.withheld.pass ? pass('passed') : fail(`failed (${receipt.withheld.category})`),
    ]);
  }
  if (receipt.reproduction) {
    rows.push([
      'Fresh reproduction',
      receipt.reproduction.held
        ? pass(`held (${receipt.reproduction.display})`)
        : fail(`did not hold (${receipt.reproduction.display})`),
    ]);
  }
  rows.push([
    'Files protected',
    receipt.pinsVerified ? pass('integrity verified') : fail('PIN VIOLATION'),
  ]);
  if (receipt.risks.length > 0) {
    rows.push(['Remaining risk', receipt.risks.join(' · ')]);
  }
  if (receipt.agent) {
    const cost = receipt.agent.costUsd != null ? `$${receipt.agent.costUsd.toFixed(2)}` : 'n/a';
    rows.push(['Cost to find', `${cost} · ${formatDuration(receipt.agent.durationMs)}`]);
  }
  rows.push([
    'Commits',
    `${receipt.baseCommit.slice(0, 7)} → ${receipt.finalCommit ? receipt.finalCommit.slice(0, 7) : '(not committed)'}`,
  ]);
  rows.push([
    'Decision',
    receipt.decision === 'accepted' ? pass(receipt.decisionReason) : fail(receipt.decisionReason),
  ]);
  rows.push(['Reproduce', receipt.reproduceCmd]);

  const labelWidth = Math.max(...rows.map(([l]) => l.length));
  const lines = rows.map(([l, v]) => `│ ${l.padEnd(labelWidth)}  ${v}`);
  const width = Math.max(...lines.map((l) => stripAnsi(l).length)) + 2;
  const top = `┌─ PAXCLI VERIFICATION ${'─'.repeat(Math.max(1, width - 23))}┐`;
  const bottom = `└${'─'.repeat(width)}┘`;
  const padded = lines.map((l) => `${l + ' '.repeat(Math.max(0, width - stripAnsi(l).length))} │`);
  return [top, ...padded, bottom].join('\n');
}

function gradeLabel(grade: Receipt['grade']): string {
  switch (grade) {
    case 'measured':
      return pc.yellow('Measured — beat the local benchmark');
    case 'validated':
      return pc.yellow('Validated — reliability checks passed');
    case 'equivalent':
      return pc.cyan('Equivalent — behavior checks passed');
    case 'reproduced':
      return pc.green('Reproduced — held in a fresh environment');
    case 'production-confirmed':
      return pc.green('Production-confirmed');
    default:
      return pc.dim('None — no verified improvement');
  }
}

function pass(text: string): string {
  return pc.green(`✓ ${text}`);
}

function fail(text: string): string {
  return pc.red(`✗ ${text}`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping requires control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
