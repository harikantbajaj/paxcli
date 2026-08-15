import type { PolicyConfig } from '../config/schema.js';

/**
 * Agents never inherit the user's full environment. Only allowlisted variable
 * names pass through — production credentials sitting in the shell should not
 * ride along into an autonomous agent run.
 */
export function buildAgentEnv(
  policy: PolicyConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const allow = new Set(policy.envAllowlist.map((n) => n.toUpperCase()));
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (allow.has(key.toUpperCase())) env[key] = value;
  }
  // The agent CLIs need their own auth/config discovery to work.
  for (const key of [
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'OPENAI_API_KEY',
    'CODEX_HOME',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMFILES',
    'PATHEXT',
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

/** Human-readable permission summary shown before every run. */
export function permissionSummary(policy: PolicyConfig, gateCmds: string[]): string {
  const lines = [
    `Paxcli may modify: ${policy.writable.join(', ')}`,
    `Protected (integrity-pinned): ${policy.protected.join(', ')}`,
    `Agents receive only allowlisted env vars (${policy.envAllowlist.length} names), never your full environment.`,
    `Gates that will run: ${gateCmds.length > 0 ? gateCmds.join(' · ') : '(none configured)'}`,
    `Dependency changes: ${policy.allowDependencyChanges ? 'allowed' : 'not allowed'}`,
  ];
  return lines.map((l) => `  ${l}`).join('\n');
}
