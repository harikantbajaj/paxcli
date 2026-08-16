import { afterEach, describe, expect, it } from 'vitest';
import { policySchema } from '../config/schema.js';
import { buildAgentEnv, permissionSummary } from './env.js';

const TEST_VARS = ['PAXCLI_TEST_ALLOWED', 'PAXCLI_TEST_SECRET', 'paxcli_test_lower'];

afterEach(() => {
  for (const key of TEST_VARS) delete process.env[key];
});

describe('buildAgentEnv', () => {
  it('passes only allowlisted variables through — secrets stay behind', () => {
    process.env.PAXCLI_TEST_ALLOWED = 'yes';
    process.env.PAXCLI_TEST_SECRET = 'prod-db-password';
    const policy = policySchema.parse({ envAllowlist: ['PAXCLI_TEST_ALLOWED'] });
    const env = buildAgentEnv(policy);
    expect(env.PAXCLI_TEST_ALLOWED).toBe('yes');
    expect(env.PAXCLI_TEST_SECRET).toBeUndefined();
  });

  it('matches allowlist names case-insensitively', () => {
    process.env.paxcli_test_lower = 'v';
    const policy = policySchema.parse({ envAllowlist: ['PAXCLI_TEST_LOWER'] });
    expect(buildAgentEnv(policy).paxcli_test_lower).toBe('v');
  });

  it('extra vars override and extend the filtered set', () => {
    const policy = policySchema.parse({ envAllowlist: [] });
    const env = buildAgentEnv(policy, { PORT: '4321' });
    expect(env.PORT).toBe('4321');
  });
});

describe('permissionSummary', () => {
  it('states writable scope, pins, env policy, and gates', () => {
    const policy = policySchema.parse({});
    const text = permissionSummary(policy, ['npm test']);
    expect(text).toContain('may modify: src/**');
    expect(text).toContain('integrity-pinned');
    expect(text).toContain('npm test');
    expect(text).toContain('never your full environment');
  });

  it('is honest when no gates are configured', () => {
    const text = permissionSummary(policySchema.parse({}), []);
    expect(text).toContain('(none configured)');
  });
});
