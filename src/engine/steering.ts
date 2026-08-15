import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Human steering: instructions the user writes (or appends via `paxcli steer`)
 * to .paxcli/steering.md while a run is active. The engine re-reads the file
 * at every round boundary and injects it into agent prompts; the content is
 * also recorded in each receipt's prompt for auditability.
 */
export function steeringPath(repoRoot: string): string {
  return path.join(repoRoot, '.paxcli', 'steering.md');
}

export async function readSteering(repoRoot: string): Promise<string | null> {
  const file = steeringPath(repoRoot);
  if (!existsSync(file)) return null;
  const text = (await readFile(file, 'utf8')).trim();
  return text.length > 0 ? text : null;
}

export async function appendSteering(repoRoot: string, message: string): Promise<string> {
  const file = steeringPath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `- ${message.trim()}\n`, 'utf8');
  return file;
}
