import pc from 'picocolors';
import type { Receipt } from '../proof/receipt.js';

/** One row of the Verification Card, before any terminal formatting. */
export interface CardRow {
  label: string;
  value: string;
  /** ✓/✗ semantics; null = neutral row. */
  mark: 'pass' | 'fail' | null;
  /** Accent for neutral rows (the grade ladder); unused when mark is set. */
  color: 'yellow' | 'cyan' | 'green' | 'dim' | null;
}

/** Pure row assembly — shared by the terminal card and markdown renderers. */
export function buildCardRows(receipt: Receipt): CardRow[] {
  const rows: CardRow[] = [];
  const neutral = (label: string, value: string): CardRow => ({
    label,
    value,
    mark: null,
    color: null,
  });
  const marked = (label: string, pass: boolean, value: string): CardRow => ({
    label,
    value,
    mark: pass ? 'pass' : 'fail',
    color: null,
  });

  if (receipt.comparison && receipt.baseline && receipt.candidate) {
    rows.push(neutral(receipt.baseline.metric, receipt.comparison.display));
  }
  const grade = gradeLabel(receipt.grade);
  rows.push({ label: 'Verification', value: grade.text, mark: null, color: grade.color });
  if (receipt.comparison) {
    rows.push(
      neutral(
        'Threshold',
        `improvement must exceed ${receipt.comparison.requiredPct.toFixed(1)}% (noise-derived)`,
      ),
    );
  }
  for (const gate of receipt.gates) {
    rows.push(
      marked(
        `Gate: ${gate.name}`,
        gate.pass,
        gate.pass ? 'passed' : `failed (exit ${gate.exitCode ?? '?'})`,
      ),
    );
  }
  if (receipt.withheld?.configured) {
    rows.push(
      marked(
        'Withheld checks',
        receipt.withheld.pass,
        receipt.withheld.pass ? 'passed' : `failed (${receipt.withheld.category})`,
      ),
    );
  }
  if (receipt.reproduction) {
    rows.push(
      marked(
        'Fresh reproduction',
        receipt.reproduction.held,
        receipt.reproduction.held
          ? `held (${receipt.reproduction.display})`
          : `did not hold (${receipt.reproduction.display})`,
      ),
    );
  }
  rows.push(
    marked(
      'Files protected',
      receipt.pinsVerified,
      receipt.pinsVerified ? 'integrity verified' : 'PIN VIOLATION',
    ),
  );
  if (receipt.risks.length > 0) {
    rows.push(neutral('Remaining risk', receipt.risks.join(' · ')));
  }
  if (receipt.agent) {
    const cost = receipt.agent.costUsd != null ? `$${receipt.agent.costUsd.toFixed(2)}` : 'n/a';
    rows.push(neutral('Cost to find', `${cost} · ${formatDuration(receipt.agent.durationMs)}`));
  }
  rows.push(
    neutral(
      'Commits',
      `${receipt.baseCommit.slice(0, 7)} → ${receipt.finalCommit ? receipt.finalCommit.slice(0, 7) : '(not committed)'}`,
    ),
  );
  rows.push(marked('Decision', receipt.decision === 'accepted', receipt.decisionReason));
  rows.push(neutral('Reproduce', receipt.reproduceCmd));
  return rows;
}

/** Renders the Verification Card — the product's face in the terminal. */
export function renderVerificationCard(receipt: Receipt): string {
  return renderCardAnsi(buildCardRows(receipt));
}

function renderCardAnsi(rows: CardRow[]): string {
  const formatted: Array<[string, string]> = rows.map((row) => {
    if (row.mark === 'pass') return [row.label, pc.green(`✓ ${row.value}`)];
    if (row.mark === 'fail') return [row.label, pc.red(`✗ ${row.value}`)];
    if (row.color) return [row.label, pc[row.color](row.value)];
    return [row.label, row.value];
  });
  const labelWidth = Math.max(...formatted.map(([l]) => l.length));
  const lines = formatted.map(([l, v]) => `│ ${l.padEnd(labelWidth)}  ${v}`);
  const width = Math.max(...lines.map((l) => stripAnsi(l).length)) + 2;
  const top = `┌─ PAXCLI VERIFICATION ${'─'.repeat(Math.max(1, width - 23))}┐`;
  const bottom = `└${'─'.repeat(width)}┘`;
  const padded = lines.map((l) => `${l + ' '.repeat(Math.max(0, width - stripAnsi(l).length))} │`);
  return [top, ...padded, bottom].join('\n');
}

function gradeLabel(grade: Receipt['grade']): { text: string; color: CardRow['color'] } {
  switch (grade) {
    case 'measured':
      return { text: 'Measured — beat the local benchmark', color: 'yellow' };
    case 'validated':
      return { text: 'Validated — reliability checks passed', color: 'yellow' };
    case 'equivalent':
      return { text: 'Equivalent — behavior checks passed', color: 'cyan' };
    case 'reproduced':
      return { text: 'Reproduced — held in a fresh environment', color: 'green' };
    case 'production-confirmed':
      return { text: 'Production-confirmed', color: 'green' };
    default:
      return { text: 'None — no verified improvement', color: 'dim' };
  }
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
