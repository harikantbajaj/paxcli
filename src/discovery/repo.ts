import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Zero-config repository discovery for task mode: package manager, validation
 * commands, and protected paths — derived from files the repository already
 * has. Everything found is persisted per run (discovery.json) so results show
 * their evidence. A paxcli.config.json, when present, overrides all of this;
 * that translation happens in the caller, not here.
 */

export interface DetectedCommand {
  cmd: string;
  /** Where the command came from, e.g. "package.json scripts.test". */
  source: string;
}

export interface RepoDiscovery {
  language: 'node' | 'python' | null;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  /** Run once in the fresh worktree before the agent starts; null = nothing to install. */
  installCmd: string | null;
  commands: {
    typecheck?: DetectedCommand;
    lint?: DetectedCommand;
    test?: DetectedCommand;
    build?: DetectedCommand;
  };
  protectedGlobs: string[];
  notes: string[];
}

/**
 * Task-mode protection defaults: git internals and CI are off-limits, and
 * EXISTING test files are integrity-pinned — the agent may add tests in new
 * files but can never weaken the ones the user already trusts. (Pins are
 * captured from files that exist at snapshot time, so new files stay legal.)
 */
export const TASK_PROTECTED_DEFAULTS = [
  'paxcli.config.json',
  '.github/**',
  'test/**',
  'tests/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/test_*.py',
  '**/*_test.py',
  '**/tests.py',
];

export async function discoverRepo(repoRoot: string): Promise<RepoDiscovery> {
  const d: RepoDiscovery = {
    language: null,
    packageManager: null,
    installCmd: null,
    commands: {},
    protectedGlobs: [...TASK_PROTECTED_DEFAULTS],
    notes: [],
  };

  const pkgPath = path.join(repoRoot, 'package.json');
  if (existsSync(pkgPath)) {
    d.language = 'node';
    d.packageManager = existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(path.join(repoRoot, 'yarn.lock'))
        ? 'yarn'
        : existsSync(path.join(repoRoot, 'bun.lockb')) ||
            existsSync(path.join(repoRoot, 'bun.lock'))
          ? 'bun'
          : 'npm';
    d.installCmd =
      d.packageManager === 'npm'
        ? existsSync(path.join(repoRoot, 'package-lock.json'))
          ? 'npm ci --no-audit --no-fund'
          : // --no-package-lock: the install must not create a lockfile the agent
            // didn't ask for — it would pollute the agent-attributed diff.
            'npm install --no-audit --no-fund --no-package-lock'
        : d.packageManager === 'pnpm'
          ? 'pnpm install --frozen-lockfile'
          : d.packageManager === 'yarn'
            ? 'yarn install --frozen-lockfile'
            : 'bun install';

    let scripts: Record<string, unknown> = {};
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
      scripts = pkg.scripts ?? {};
    } catch {
      d.notes.push('package.json is not valid JSON — npm scripts were skipped.');
    }
    const runPrefix = d.packageManager === 'yarn' ? 'yarn' : `${d.packageManager} run`;
    const pick = (names: string[]): DetectedCommand | undefined => {
      for (const name of names) {
        const script = scripts[name];
        if (typeof script !== 'string' || !script.trim()) continue;
        if (/no test specified/i.test(script)) continue; // npm init placeholder
        return { cmd: `${runPrefix} ${name}`, source: `package.json scripts.${name}` };
      }
      return undefined;
    };
    const typecheck = pick(['typecheck', 'type-check', 'check:types', 'tsc']);
    const lint = pick(['lint', 'check:lint']);
    const test = pick(['test']);
    const build = pick(['build']);
    if (typecheck) d.commands.typecheck = typecheck;
    if (lint) d.commands.lint = lint;
    if (test) d.commands.test = test;
    if (build) d.commands.build = build;
  }

  if (!d.commands.test) {
    if (existsSync(path.join(repoRoot, 'manage.py'))) {
      d.language ??= 'python';
      d.commands.test = { cmd: 'python manage.py test', source: 'manage.py (Django)' };
    } else if (existsSync(path.join(repoRoot, 'pyproject.toml'))) {
      d.language ??= 'python';
      const text = await readFile(path.join(repoRoot, 'pyproject.toml'), 'utf8');
      if (/\bpytest\b/.test(text)) {
        d.commands.test = { cmd: 'pytest', source: 'pyproject.toml' };
      }
    } else if (existsSync(path.join(repoRoot, 'requirements.txt'))) {
      d.language ??= 'python';
      const text = await readFile(path.join(repoRoot, 'requirements.txt'), 'utf8');
      if (/^pytest\b/m.test(text)) {
        d.commands.test = { cmd: 'pytest', source: 'requirements.txt' };
      }
    }
  }

  if (existsSync(path.join(repoRoot, '.env'))) {
    d.notes.push(
      '.env exists but is never copied into the isolated worktree — commands that need those variables may fail there while passing locally.',
    );
  }
  if (Object.keys(d.commands).length === 0) {
    d.notes.push(
      'No validation commands found (no usable npm scripts, manage.py, or pytest setup) — the change will not be tested by paxcli.',
    );
  }
  return d;
}

export function describeDiscovery(d: RepoDiscovery): string {
  const checks = (['typecheck', 'lint', 'test', 'build'] as const)
    .filter((k) => d.commands[k])
    .map((k) => (d.commands[k] as DetectedCommand).cmd);
  const lang = d.language ?? 'unknown';
  const pm = d.packageManager ? ` (${d.packageManager})` : '';
  return `Repository: ${lang}${pm} · checks: ${checks.length > 0 ? checks.join(' · ') : 'none found'}`;
}
