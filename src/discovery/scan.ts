import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';

/**
 * Static discovery: scans source files for common performance smells and
 * ranks them. Deliberately honest about what it is — pattern heuristics that
 * suggest WHERE to look, not proof that something is slow. The benchmark
 * decides what is actually slow; the user decides what paxcli may attempt.
 */

export interface DiscoveryFinding {
  category: string;
  file: string;
  line: number;
  snippet: string;
  /** 1 (weak signal) … 5 (strong signal). */
  confidence: number;
  why: string;
}

interface Rule {
  category: string;
  pattern: RegExp;
  confidence: number;
  why: string;
}

const RULES: Rule[] = [
  {
    category: 'await-in-loop',
    pattern: /for\s*(?:\(|\s*await)[^\n]*\)\s*\{[^}]*?\bawait\s/s,
    confidence: 4,
    why: 'Sequential awaits in a loop usually serialize work that could run concurrently (Promise.all) — a classic N+1 shape.',
  },
  {
    category: 'json-deep-clone',
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/,
    confidence: 5,
    why: 'JSON round-trip cloning is slow and lossy; structuredClone or a shallow copy is usually much faster.',
  },
  {
    category: 'sync-fs-in-src',
    pattern: /\b(?:readFileSync|writeFileSync|existsSync|readdirSync)\s*\(/,
    confidence: 3,
    why: 'Synchronous filesystem calls block the event loop; on a request path they serialize all traffic.',
  },
  {
    category: 'foreach-async',
    pattern: /\.forEach\s*\(\s*async\b/,
    confidence: 4,
    why: 'forEach(async …) neither awaits nor bounds concurrency — results race and errors vanish.',
  },
  {
    category: 'nested-array-scan',
    pattern:
      /\.(?:filter|find|some|includes|indexOf)\([^)]*\)[^\n]*\n[^\n]*\.(?:map|filter|forEach|find)\s*\(/,
    confidence: 2,
    why: 'Array scan inside another array operation is O(n·m); a Set/Map lookup is usually O(1).',
  },
  {
    category: 'unbounded-concurrency',
    pattern: /Promise\.all\s*\(\s*[A-Za-z_$][\w$]*\s*\.map\s*\(/,
    confidence: 2,
    why: 'Promise.all over an unbounded map can stampede a database or API; consider a concurrency limit.',
  },
];

export async function discover(
  repoRoot: string,
  writableGlobs: string[],
): Promise<DiscoveryFinding[]> {
  const files = await glob(
    writableGlobs.length > 0 ? writableGlobs : ['src/**/*.{js,ts,mjs,cjs,jsx,tsx}'],
    {
      cwd: repoRoot,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/*.test.*', '**/*.spec.*', '.paxcli/**'],
    },
  );
  const findings: DiscoveryFinding[] = [];
  for (const rel of files) {
    if (!/\.(?:js|ts|mjs|cjs|jsx|tsx)$/.test(rel)) continue;
    let content: string;
    try {
      content = await readFile(path.join(repoRoot, rel), 'utf8');
    } catch {
      continue;
    }
    for (const rule of RULES) {
      const match = rule.pattern.exec(content);
      if (!match) continue;
      const line = content.slice(0, match.index).split('\n').length;
      findings.push({
        category: rule.category,
        file: rel.replaceAll('\\', '/'),
        line,
        snippet: (match[0] ?? '').split('\n')[0]?.trim().slice(0, 80) ?? '',
        confidence: rule.confidence,
        why: rule.why,
      });
    }
  }
  return findings.sort((a, b) => b.confidence - a.confidence);
}
