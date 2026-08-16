import { describe, expect, it } from 'vitest';
import { type StreamedRun, buildAgentRunResult, feedJsonlChunk } from './stream.js';
import type { AgentSpawnOpts } from './types.js';

describe('feedJsonlChunk', () => {
  it('splits complete lines and carries the trailing fragment', () => {
    const first = feedJsonlChunk('', '{"a":1}\n{"b":');
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.carry).toBe('{"b":');

    const second = feedJsonlChunk(first.carry, '2}\n');
    expect(second.lines).toEqual(['{"b":2}']);
    expect(second.carry).toBe('');
  });

  it('drops blank lines and trims CRLF endings', () => {
    const fed = feedJsonlChunk('', '{"a":1}\r\n\r\n{"b":2}\r\n');
    expect(fed.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(fed.carry).toBe('');
  });

  it('handles a chunk with no newline at all', () => {
    const fed = feedJsonlChunk('{"par', 'tial"');
    expect(fed.lines).toEqual([]);
    expect(fed.carry).toBe('{"partial"');
  });
});

function spawnOpts(aborted = false): AgentSpawnOpts {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    prompt: 'p',
    cwd: '.',
    timeoutMs: 1000,
    signal: controller.signal,
    env: {},
    logPath: '/runs/x/traces/n/agent.jsonl',
  };
}

const okRun: StreamedRun = { exitCode: 0, timedOut: false, stderr: '', durationMs: 42 };

describe('buildAgentRunResult', () => {
  const base = { finalText: 'done', costUsd: 0.5, tokensIn: 10, tokensOut: 20 };

  it('maps a clean exit to completed', () => {
    const result = buildAgentRunResult({ run: okRun, opts: spawnOpts(), label: 'X', ...base });
    expect(result).toMatchObject({ ok: true, exitReason: 'completed', finalText: 'done' });
  });

  it('cancelled beats every other outcome', () => {
    const result = buildAgentRunResult({
      run: { ...okRun, exitCode: 1, timedOut: true },
      opts: spawnOpts(true),
      label: 'X',
      ...base,
    });
    expect(result.exitReason).toBe('cancelled');
  });

  it('timeout beats error', () => {
    const result = buildAgentRunResult({
      run: { ...okRun, exitCode: 1, timedOut: true },
      opts: spawnOpts(),
      label: 'X',
      ...base,
    });
    expect(result.exitReason).toBe('timeout');
  });

  it('failures point at the JSONL trace and include the stderr tail', () => {
    const result = buildAgentRunResult({
      run: { ...okRun, exitCode: 2, stderr: 'boom happened' },
      opts: spawnOpts(),
      label: 'Claude Code',
      ...base,
      finalText: '',
    });
    expect(result.ok).toBe(false);
    expect(result.exitReason).toBe('error');
    expect(result.finalText).toContain('Claude Code exited 2');
    expect(result.finalText).toContain('boom happened');
    expect(result.finalText).toContain('agent trace: /runs/x/traces/n/agent.jsonl');
  });

  it('honors an adapter-specific failure flag even on exit 0', () => {
    const result = buildAgentRunResult({
      run: okRun,
      opts: spawnOpts(),
      label: 'X',
      ...base,
      failed: true, // e.g. Claude's stream ended without a result event
    });
    expect(result.ok).toBe(false);
    expect(result.exitReason).toBe('error');
  });
});
