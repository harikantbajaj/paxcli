import type { DetectedCommand, RepoDiscovery } from '../discovery/repo.js';

/**
 * Prompts for general task mode. Unlike optimization prompts there is no
 * metric — the contract is: implement the request, pass the discovered
 * validation commands, never touch pinned files, and report a SUMMARY line.
 */

export function buildTaskPrompt(params: {
  task: string;
  discovery: RepoDiscovery;
  protectedGlobs: string[];
}): string {
  const { task, discovery } = params;
  const checks = (['typecheck', 'lint', 'test', 'build'] as const)
    .filter((k) => discovery.commands[k])
    .map((k) => (discovery.commands[k] as DetectedCommand).cmd);
  const lines: string[] = [
    'You are implementing a change in this repository. The user asked for:',
    '',
    task,
    '',
    'REPOSITORY FACTS (auto-detected):',
    `- Language: ${discovery.language ?? 'unknown'}${discovery.packageManager ? ` (${discovery.packageManager})` : ''}`,
    checks.length > 0
      ? `- After you finish, these commands must pass, in order: ${checks.join(' ; ')}. You may run them yourself to check your work.`
      : '- No test/lint/build commands were detected; be extra careful — nothing will catch a mistake automatically.',
    '',
    'RULES:',
    '- Implement exactly what was requested. Keep the change minimal and focused; do not refactor unrelated code.',
    `- These files are integrity-pinned; ANY edit to them auto-rejects your work: ${params.protectedGlobs.join(', ')}`,
    '- Do not weaken, skip, or delete existing tests. Add tests for new behavior in NEW files where reasonable.',
    '- Avoid adding dependencies unless truly necessary; any dependency change is flagged for human review.',
    '- Never touch .git internals, CI workflows, or credential/.env files.',
    '',
    'When you are done, end your final message with a single line:',
    'SUMMARY: <one sentence describing what you changed>',
  ];
  return lines.join('\n');
}

export function buildRepairPrompt(params: {
  task: string;
  checkName: string;
  cmd: string;
  outputTail: string;
  attempt: number;
  maxRepairs: number;
}): string {
  return [
    `You previously attempted this task: ${params.task}`,
    '',
    'Your change failed validation.',
    `Failed check: ${params.checkName}`,
    `Command: ${params.cmd}`,
    'Output (tail):',
    params.outputTail,
    '',
    'Fix the failure. Keep your earlier work unless it caused the failure.',
    'Do not weaken, skip, or delete tests to make them pass — fix the actual problem.',
    `This is repair attempt ${params.attempt} of ${params.maxRepairs}.`,
    '',
    'End your final message with a single line:',
    'SUMMARY: <one sentence describing what you changed>',
  ].join('\n');
}

export function extractSummary(finalText: string): string {
  const match = finalText.match(/SUMMARY:\s*(.+)/i);
  return (
    match?.[1]?.trim() ?? finalText.trim().split('\n').at(-1)?.slice(0, 200) ?? 'No summary stated'
  );
}
