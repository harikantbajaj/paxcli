import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type Comparison, compare } from '../bench/stats.js';
import type { PaxcliConfig } from '../config/schema.js';
import type { Score } from '../tree/types.js';

/**
 * CI regression prevention: a committed baseline snapshot plus a verify
 * command that fails the build when performance regresses beyond tolerance.
 * This is what keeps a merged win from silently eroding.
 */

export interface BaselineSnapshot {
  version: 1;
  metric: string;
  direction: 'minimize' | 'maximize';
  samples: number[];
  median: number;
  capturedAt: string;
  commit: string | null;
}

export function baselinePath(repoRoot: string): string {
  return path.join(repoRoot, '.paxcli', 'baseline.json');
}

export async function writeBaseline(
  repoRoot: string,
  score: Score,
  commit: string | null,
): Promise<string> {
  const file = baselinePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  const snapshot: BaselineSnapshot = {
    version: 1,
    metric: score.metric,
    direction: score.direction,
    samples: score.samples,
    median: score.value,
    capturedAt: new Date().toISOString(),
    commit,
  };
  await writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');
  return file;
}

export async function readBaseline(repoRoot: string): Promise<BaselineSnapshot | null> {
  const file = baselinePath(repoRoot);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')) as BaselineSnapshot;
}

export interface RegressionVerdict {
  ok: boolean;
  comparison: Comparison;
  message: string;
}

/**
 * Positive `improvementPct` means current is BETTER than the stored baseline.
 * A regression beyond max(noise, tolerance) fails.
 */
export function judgeRegression(
  snapshot: BaselineSnapshot,
  current: Score,
  config: PaxcliConfig,
  tolerancePct: number,
): RegressionVerdict {
  const comparison = compare(
    snapshot.samples,
    current.samples,
    snapshot.direction,
    config.search.minImprovementPct,
  );
  const regressionPct = -comparison.improvementPct;
  const allowed = Math.max(comparison.noiseFloorPct, tolerancePct);
  if (regressionPct > allowed) {
    return {
      ok: false,
      comparison,
      message: `Performance regression: ${snapshot.metric} degraded ${regressionPct.toFixed(1)}% vs the stored baseline (allowed: ${allowed.toFixed(1)}%). ${comparison.display}`,
    };
  }
  return {
    ok: true,
    comparison,
    message: `No regression beyond tolerance: ${comparison.display}`,
  };
}
