import { describe, expect, it } from 'vitest';
import { configHash, parseConfig } from './schema.js';

const minimal = {
  benchmark: {
    sampleCmd: 'node bench.js',
    metric: 'latency_ms',
    direction: 'minimize',
  },
};

describe('config schema', () => {
  it('fills defaults for a minimal config', () => {
    const cfg = parseConfig(JSON.stringify(minimal));
    expect(cfg.search.parallel).toBe(2);
    expect(cfg.budget.maxCostUsd).toBe(5);
    expect(cfg.policy.level).toBe('standard');
    expect(cfg.policy.envAllowlist).toContain('PATH');
    expect(cfg.host.id).toBe('claude-code');
  });

  it('rejects invalid JSON with a helpful message', () => {
    expect(() => parseConfig('{nope')).toThrow(/not valid JSON/);
  });

  it('reports the failing path on validation errors', () => {
    const bad = { benchmark: { sampleCmd: '', metric: 'x', direction: 'sideways' } };
    expect(() => parseConfig(JSON.stringify(bad))).toThrow(/benchmark/);
  });

  it('hashes configs stably', () => {
    const a = parseConfig(JSON.stringify(minimal));
    const b = parseConfig(JSON.stringify(minimal));
    expect(configHash(a)).toBe(configHash(b));
  });
});
