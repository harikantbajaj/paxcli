import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { discoverRepo } from './repo.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'paxcli-disc-'));
});

describe('discoverRepo', () => {
  it('detects npm scripts, package manager, and install command', async () => {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'vitest run',
          lint: 'biome check src',
          typecheck: 'tsc --noEmit',
          build: 'tsup',
        },
      }),
    );
    await writeFile(path.join(root, 'package-lock.json'), '{}');
    const d = await discoverRepo(root);
    expect(d.language).toBe('node');
    expect(d.packageManager).toBe('npm');
    expect(d.installCmd).toBe('npm ci --no-audit --no-fund');
    expect(d.commands.test?.cmd).toBe('npm run test');
    expect(d.commands.lint?.cmd).toBe('npm run lint');
    expect(d.commands.typecheck?.cmd).toBe('npm run typecheck');
    expect(d.commands.build?.cmd).toBe('npm run build');
  });

  it('skips the npm init placeholder test script and says so', async () => {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    const d = await discoverRepo(root);
    expect(d.commands.test).toBeUndefined();
    expect(d.notes.some((n) => n.includes('No validation commands found'))).toBe(true);
  });

  it('prefers pnpm when its lockfile is present', async () => {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest' } }),
    );
    await writeFile(path.join(root, 'pnpm-lock.yaml'), '');
    const d = await discoverRepo(root);
    expect(d.packageManager).toBe('pnpm');
    expect(d.commands.test?.cmd).toBe('pnpm run test');
  });

  it('detects Django via manage.py', async () => {
    await writeFile(path.join(root, 'manage.py'), '#!/usr/bin/env python\n');
    const d = await discoverRepo(root);
    expect(d.language).toBe('python');
    expect(d.commands.test?.cmd).toBe('python manage.py test');
  });

  it('notes when .env exists (it never enters the worktree)', async () => {
    await writeFile(path.join(root, '.env'), 'SECRET=1\n');
    const d = await discoverRepo(root);
    expect(d.notes.some((n) => n.includes('.env'))).toBe(true);
  });
});
