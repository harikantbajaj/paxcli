import type { PaxcliConfig } from '../config/schema.js';
import { type ExperimentNode, betterThan } from '../tree/types.js';

/**
 * Parent selection for the next experiment. `best-first` always extends the
 * best accepted node; `epsilon-greedy` occasionally branches from a random
 * accepted node (or the root) so the search does not collapse into one path.
 * Returning null means "branch from the run's base commit".
 */
export function selectParent(
  nodes: Map<string, ExperimentNode>,
  config: PaxcliConfig,
  rand: () => number = Math.random,
): ExperimentNode | null {
  const accepted = [...nodes.values()].filter((n) => n.status === 'accepted' && n.score);
  if (accepted.length === 0) return null;

  let best: ExperimentNode | null = null;
  for (const node of accepted) {
    if (
      !best ||
      betterThan(
        (node.score as NonNullable<typeof node.score>).value,
        (best.score as NonNullable<typeof best.score>).value,
        config.benchmark.direction,
      )
    ) {
      best = node;
    }
  }

  if (config.search.strategy === 'epsilon-greedy' && rand() < config.search.epsilon) {
    // Explore: uniform choice among the root and every accepted node.
    const pool: Array<ExperimentNode | null> = [null, ...accepted];
    return pool[Math.floor(rand() * pool.length)] ?? null;
  }
  return best;
}
