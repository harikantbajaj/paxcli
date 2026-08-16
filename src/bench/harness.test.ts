import { describe, expect, it } from 'vitest';
import { parseSampleOutput } from './harness.js';

describe('parseSampleOutput', () => {
  it('parses a clean single-line result', () => {
    expect(parseSampleOutput('{"metric":"p50_ms","value":12.5}')).toEqual({
      metric: 'p50_ms',
      value: 12.5,
    });
  });

  it('takes the LAST valid JSON line, ignoring app logging above it', () => {
    const stdout = [
      'server listening on 3000',
      '{"level":"info","msg":"warmup"}', // JSON but not a result line
      '{"metric":"p50_ms","value":9,"secondary":{"memory_mb":80}}',
    ].join('\n');
    expect(parseSampleOutput(stdout)).toEqual({
      metric: 'p50_ms',
      value: 9,
      secondary: { memory_mb: 80 },
    });
  });

  it('keeps scanning upward past trailing non-result output', () => {
    const stdout = ['{"metric":"p50_ms","value":7}', 'shutting down...', '{broken json'].join('\n');
    expect(parseSampleOutput(stdout)?.value).toBe(7);
  });

  it('rejects lines with the wrong field types', () => {
    expect(parseSampleOutput('{"metric":123,"value":"fast"}')).toBeNull();
  });

  it('returns null when no result line exists', () => {
    expect(parseSampleOutput('just logs\nno json here')).toBeNull();
    expect(parseSampleOutput('')).toBeNull();
  });
});
