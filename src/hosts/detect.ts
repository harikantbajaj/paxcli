import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { ClaudeCodeAdapter, createHostAdapter } from './claude-code/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import type { HostAdapter } from './types.js';

/**
 * Automatic host selection so nobody ever types --host. Both known agent CLIs
 * are probed for installation AND authentication; a config/flag preference
 * always wins. Ranking on auto-detect: confirmed-authenticated hosts before
 * unknown-auth hosts (a login we cannot verify may still fail mid-run), and
 * claude-code before codex within a tier (locked product decision).
 * Claude Code on macOS stores credentials in the keychain, so its auth can be
 * 'unknown' while actually signed in — the ranking accepts that trade-off.
 */

export interface DetectedHost {
  id: 'claude-code' | 'codex';
  label: string;
  installed: boolean;
  version: string | null;
  /** true = confirmed signed in, false = confirmed signed out, null = unknown. */
  authenticated: boolean | null;
  /** Exact install/login instruction when not usable. */
  problem: string | null;
}

export const HOST_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  mock: 'mock host',
};

export async function detectHosts(): Promise<DetectedHost[]> {
  const [claude, codex] = await Promise.all([detectClaudeCode(), detectCodex()]);
  return [claude, codex];
}

async function detectClaudeCode(): Promise<DetectedHost> {
  const base: DetectedHost = {
    id: 'claude-code',
    label: HOST_LABELS['claude-code'] as string,
    installed: false,
    version: null,
    authenticated: null,
    problem: null,
  };
  const det = await new ClaudeCodeAdapter().detect();
  if (!det.found) return { ...base, problem: det.problem ?? 'not found' };
  base.installed = true;
  base.version = det.version ?? null;
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    base.authenticated = true;
  } else if (existsSync(path.join(os.homedir(), '.claude', '.credentials.json'))) {
    base.authenticated = true;
  }
  // No negative signal is reliable (macOS keeps credentials in the keychain),
  // so authentication is never reported as confirmed-false for Claude Code.
  return base;
}

async function detectCodex(): Promise<DetectedHost> {
  const base: DetectedHost = {
    id: 'codex',
    label: HOST_LABELS.codex as string,
    installed: false,
    version: null,
    authenticated: null,
    problem: null,
  };
  const det = await new CodexAdapter().detect();
  if (!det.found) return { ...base, problem: det.problem ?? 'not found' };
  base.installed = true;
  base.version = det.version ?? null;
  try {
    const result = await execa('codex', ['login', 'status'], {
      shell: true,
      timeout: 15_000,
      reject: false,
    });
    if (!result.timedOut) {
      base.authenticated = result.exitCode === 0;
      if (base.authenticated === false) {
        base.problem = 'Codex CLI is installed but signed out. Run `codex login` once.';
      }
    }
  } catch {
    // status subcommand missing or crashed — leave authentication unknown
  }
  return base;
}

export interface HostChoice {
  adapter: HostAdapter;
  id: string;
  label: string;
  version: string | null;
}

export async function chooseTaskHost(
  preferred?: string,
  mockPatchesFile?: string,
): Promise<HostChoice> {
  if (preferred) {
    const adapter = await createHostAdapter(preferred, mockPatchesFile);
    const det = await adapter.detect();
    if (!det.found) throw new Error(det.problem ?? `Host "${preferred}" is not available.`);
    return {
      adapter,
      id: preferred,
      label: HOST_LABELS[preferred] ?? preferred,
      version: det.version ?? null,
    };
  }

  const hosts = await detectHosts();
  const usable = hosts.filter((h) => h.installed && h.authenticated !== false);
  const pick =
    usable.find((h) => h.authenticated === true && h.id === 'claude-code') ??
    usable.find((h) => h.authenticated === true) ??
    usable.find((h) => h.id === 'claude-code') ??
    usable[0];
  if (pick) {
    const adapter = await createHostAdapter(pick.id);
    return { adapter, id: pick.id, label: pick.label, version: pick.version };
  }

  const signedOut = hosts.find((h) => h.installed && h.authenticated === false);
  if (signedOut) throw new Error(signedOut.problem ?? `${signedOut.label} needs a login.`);
  throw new Error(
    [
      'No coding agent CLI found. Install one of:',
      '  npm install -g @anthropic-ai/claude-code   (then sign in once with `claude`)',
      '  npm install -g @openai/codex               (then sign in once with `codex login`)',
    ].join('\n'),
  );
}
