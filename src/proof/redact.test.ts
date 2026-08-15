import { describe, expect, it } from 'vitest';
import { containsSecrets, redactText, redactValue } from './redact.js';

describe('receipt redaction', () => {
  it('redacts provider-shaped API keys', () => {
    const text = 'const key = "sk-abcdef1234567890abcdef";';
    expect(redactText(text)).not.toContain('sk-abcdef');
    expect(containsSecrets(text)).toBe(true);
  });

  it('redacts AWS access keys and GitHub tokens', () => {
    expect(redactText('AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED_AWS_KEY]');
    expect(redactText('token: ghp_abcdefghij1234567890abcdefghij')).toContain(
      '[REDACTED_GITHUB_TOKEN]',
    );
  });

  it('redacts assignment-shaped secrets', () => {
    const out = redactText('DATABASE_PASSWORD=hunter2secret');
    expect(out).not.toContain('hunter2secret');
  });

  it('redacts credentials inside connection strings', () => {
    const out = redactText('postgres://admin:s3cr3tpass@db.internal:5432/app');
    expect(out).not.toContain('s3cr3tpass');
    expect(out).toContain('admin');
  });

  it('deep-redacts nested receipt structures', () => {
    const receipt = {
      prompt: 'use Bearer abc123def456ghi789 for auth',
      nested: { diff: ['api_key = "supersecretvalue1"'] },
      cost: 1.5,
    };
    const out = redactValue(receipt);
    expect(JSON.stringify(out)).not.toContain('abc123def456ghi789');
    expect(JSON.stringify(out)).not.toContain('supersecretvalue1');
    expect(out.cost).toBe(1.5);
  });

  it('leaves ordinary code untouched', () => {
    const text = 'const uniqueCount = new Set(data).size;';
    expect(redactText(text)).toBe(text);
    expect(containsSecrets(text)).toBe(false);
  });
});
