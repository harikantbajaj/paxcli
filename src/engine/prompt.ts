import type { PaxcliConfig } from '../config/schema.js';
import type { Insight, Score } from '../tree/types.js';

/**
 * Builds the experiment prompt handed to the coding agent. The agent gets the
 * goal, the measurement contract, what earlier experiments learned, and the
 * rules — including that protected files are hash-pinned and editing them
 * rejects the experiment automatically.
 */
export function buildExperimentPrompt(params: {
  config: PaxcliConfig;
  baseline: Score;
  bestSoFar: Score | null;
  insights: Insight[];
  steering?: string | null;
  /** Researcher-proposed plan (split-roles mode); the executor implements it. */
  plan?: string | null;
}): string {
  const { config, baseline, bestSoFar, insights } = params;
  const direction = config.benchmark.direction === 'minimize' ? 'reduce' : 'increase';
  const lines: string[] = [
    `You are optimizing this repository for performance. Your single goal: ${direction} the metric "${config.benchmark.metric}".`,
    '',
    `Current baseline: ${baseline.value.toFixed(2)} (median of ${baseline.samples.length} samples).`,
  ];
  if (bestSoFar) {
    lines.push(
      `Best result so far this run: ${bestSoFar.value.toFixed(2)}. You must beat it meaningfully.`,
    );
  }
  lines.push(
    '',
    `The benchmark is executed as: ${config.benchmark.sampleCmd}`,
    'You may run it yourself to check progress, but the authoritative measurement is done by the harness after you finish.',
    '',
    'RULES:',
    `- Modify only files matching: ${config.policy.writable.join(', ')}`,
    `- These files are integrity-pinned; changing them auto-rejects your work: ${config.policy.protected.join(', ')}`,
    '- Do not weaken, skip, or delete tests. Do not special-case benchmark inputs. Your change must be a genuine improvement.',
    config.policy.allowDependencyChanges
      ? '- You may add dependencies if clearly justified.'
      : '- Do not add or change dependencies.',
    '- Keep the public API unchanged.',
  );
  if (config.constraints.length > 0) {
    lines.push(
      '',
      'CONSTRAINTS (checked after your change):',
      ...config.constraints.map(
        (c) => `- ${c.metric} must not increase more than ${c.maxIncreasePct}%`,
      ),
    );
  }
  const recent = insights.slice(-8);
  if (recent.length > 0) {
    lines.push(
      '',
      'WHAT EARLIER EXPERIMENTS LEARNED (do not repeat rejected approaches):',
      ...recent.map((i) => `- [${i.kind}] ${i.text}`),
    );
  }
  if (params.steering) {
    lines.push(
      '',
      'USER STEERING (instructions from the human running this — you must follow them):',
      params.steering,
    );
  }
  if (params.plan) {
    lines.push(
      '',
      'A researcher already analyzed the codebase and proposed this plan — implement exactly this approach:',
      params.plan,
    );
  }
  lines.push(
    '',
    'When you are done, end your final message with a single line:',
    'HYPOTHESIS: <one sentence describing the change you made and why it should be faster>',
  );
  return lines.join('\n');
}

/**
 * Researcher prompt (split-roles mode): analyze and propose, but change
 * nothing. The executor implements the returned plan in a separate call.
 */
export function buildResearchPrompt(params: {
  config: PaxcliConfig;
  baseline: Score;
  bestSoFar: Score | null;
  insights: Insight[];
  steering?: string | null;
}): string {
  const { config, baseline, bestSoFar, insights } = params;
  const direction = config.benchmark.direction === 'minimize' ? 'reduce' : 'increase';
  const lines: string[] = [
    `You are a performance researcher. Analyze this repository and propose ONE concrete change to ${direction} the metric "${config.benchmark.metric}".`,
    `Current baseline: ${baseline.value.toFixed(2)}.`,
    bestSoFar
      ? `Best so far this run: ${bestSoFar.value.toFixed(2)} — your proposal must plausibly beat it.`
      : '',
    '',
    'DO NOT edit any files. Read the code, then answer with exactly:',
    'HYPOTHESIS: <one sentence>',
    'APPROACH: <3-6 sentences: which files to change and how>',
  ].filter(Boolean);
  const recent = insights.slice(-8);
  if (recent.length > 0) {
    lines.push('', 'Already ruled out:', ...recent.map((i) => `- ${i.text}`));
  }
  if (params.steering) {
    lines.push('', 'USER STEERING (must follow):', params.steering);
  }
  return lines.join('\n');
}

export function extractHypothesis(finalText: string): string {
  const match = finalText.match(/HYPOTHESIS:\s*(.+)/i);
  return (
    match?.[1]?.trim() ??
    finalText.trim().split('\n').at(-1)?.slice(0, 200) ??
    'No hypothesis stated'
  );
}
