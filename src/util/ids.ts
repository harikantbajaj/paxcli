import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short, filesystem- and branch-safe id (worktree paths must stay short on Windows). */
export function shortId(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  }
  return out;
}

export function runId(now = new Date()): string {
  // Date AND time in the id so runs sort chronologically — "latest run"
  // resolution depends on lexicographic order.
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return `${stamp}-${shortId(4)}`;
}
