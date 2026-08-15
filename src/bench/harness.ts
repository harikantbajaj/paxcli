import { createServer } from 'node:net';
import { type ResultPromise, execa } from 'execa';
import type { BenchmarkConfig } from '../config/schema.js';
import type { Score } from '../tree/types.js';
import { type StabilityVerdict, assessStability, summarize } from './stats.js';

/**
 * Benchmark harness. Owns the measurement lifecycle:
 *   setup → (start app → readiness probe) → warm-up → sample×N (reset between) → shutdown
 *
 * The sample command prints one JSON line to stdout per invocation:
 *   {"metric": "p95_latency_ms", "value": 123.4, "secondary": {"memory_mb": 87}}
 */

export interface SampleOutput {
  metric: string;
  value: number;
  secondary?: Record<string, number>;
}

export interface MeasureResult {
  score: Score;
  stability: StabilityVerdict;
  /** Median of each secondary metric across samples. */
  secondaryMedians: Record<string, number>;
}

export interface HarnessOptions {
  cwd: string;
  env?: Record<string, string>;
  onStatus?: (msg: string) => void;
}

export class BenchmarkHarness {
  constructor(
    private readonly config: BenchmarkConfig,
    private readonly opts: HarnessOptions,
  ) {}

  async measure(label: string): Promise<MeasureResult> {
    const status = this.opts.onStatus ?? (() => {});
    let server: ResultPromise | null = null;
    let port: number | null = null;
    const env: Record<string, string> = { ...this.opts.env };

    try {
      if (this.config.setupCmd) {
        status(`Preparing benchmark environment (${label})`);
        await this.run(this.config.setupCmd, env, this.config.sampleTimeoutMs);
      }

      if (this.config.server) {
        port = await findFreePort();
        env.PORT = String(port);
        env.TARGET_URL = `http://127.0.0.1:${port}`;
        status(`Starting application on port ${port}`);
        const outputTail = new OutputTail();
        server = execa(this.config.server.startCmd, {
          cwd: this.opts.cwd,
          env,
          shell: true,
          buffer: false,
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          detached: false,
        });
        server.catch(() => {});
        server.stdout?.on('data', (c: Buffer) => outputTail.push(c));
        server.stderr?.on('data', (c: Buffer) => outputTail.push(c));
        await this.waitReady(port, server, outputTail);
      }

      status(`Warming up (${this.config.warmupSamples} rounds)`);
      for (let i = 0; i < this.config.warmupSamples; i++) {
        await this.sampleOnce(env);
      }

      const values: number[] = [];
      const secondaries: Record<string, number[]> = {};
      let metricName = this.config.metric;
      for (let i = 0; i < this.config.samples; i++) {
        if (this.config.resetCmd)
          await this.run(this.config.resetCmd, env, this.config.sampleTimeoutMs);
        const sample = await this.sampleOnce(env);
        if (sample.metric !== this.config.metric) {
          throw new Error(
            `Benchmark reported metric "${sample.metric}" but config expects "${this.config.metric}"`,
          );
        }
        metricName = sample.metric;
        values.push(sample.value);
        for (const [k, v] of Object.entries(sample.secondary ?? {})) {
          const list = secondaries[k] ?? [];
          list.push(v);
          secondaries[k] = list;
        }
        status(`Sampling ${label}: ${i + 1}/${this.config.samples}`);
      }

      const secondaryMedians: Record<string, number> = {};
      for (const [k, vals] of Object.entries(secondaries)) {
        secondaryMedians[k] = summarize(vals).median;
      }

      return {
        score: {
          metric: metricName,
          value: summarize(values).median,
          direction: this.config.direction,
          samples: values,
          secondary: secondaryMedians,
        },
        stability: assessStability(values, this.config.maxNoisePct),
        secondaryMedians,
      };
    } finally {
      if (server) await stopProcess(server);
    }
  }

  private async sampleOnce(env: Record<string, string>): Promise<SampleOutput> {
    const stdout = await this.run(this.config.sampleCmd, env, this.config.sampleTimeoutMs);
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = (lines[i] as string).trim();
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line) as SampleOutput;
        if (typeof parsed.metric === 'string' && typeof parsed.value === 'number') return parsed;
      } catch {
        // keep scanning upward for the JSON result line
      }
    }
    throw new Error(
      `Benchmark sample command produced no JSON result line ({"metric": ..., "value": ...}). Output tail:\n${stdout.slice(-500)}`,
    );
  }

  private async run(cmd: string, env: Record<string, string>, timeoutMs: number): Promise<string> {
    const { stdout } = await execa(cmd, {
      cwd: this.opts.cwd,
      env,
      shell: true,
      timeout: timeoutMs,
      all: false,
    });
    return String(stdout);
  }

  private async waitReady(port: number, server: ResultPromise, tail: OutputTail): Promise<void> {
    const cfg = this.config.server;
    if (!cfg) return;
    const url = cfg.readyUrl.replace('{port}', String(port));
    const deadline = Date.now() + cfg.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (server.exitCode !== undefined && server.exitCode !== null) {
        // Windows reports negative exit codes as large unsigned ints; show the
        // signed value people can actually search for.
        const signed =
          server.exitCode > 0x7fffffff ? server.exitCode - 0x100000000 : server.exitCode;
        throw new Error(
          `Your server.startCmd (\`${cfg.startCmd}\`) exited with code ${signed} before becoming ready.\nCheck that the command works when run manually and that your app listens on the PORT env var.\nApplication output:\n${tail.text() || '  (no output captured)'}`,
        );
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await sleep(300);
    }
    throw new Error(
      `Application never became ready at ${url} within ${cfg.readyTimeoutMs}ms.\nCheck that your app listens on the PORT env var and serves the readiness URL.\nApplication output:\n${tail.text() || '  (no output captured)'}`,
    );
  }
}

/** Keeps the last ~2KB of a process's combined output for diagnostics. */
class OutputTail {
  private buf = '';
  push(chunk: Buffer): void {
    this.buf = (this.buf + chunk.toString('utf8')).slice(-2048);
  }
  text(): string {
    return this.buf
      .trim()
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
  }
}

async function stopProcess(proc: ResultPromise): Promise<void> {
  try {
    // shell:true means proc is the shell; on Windows killing it leaves the
    // real server running as an orphaned grandchild. Kill the whole tree.
    if (process.platform === 'win32' && proc.pid) {
      await execa('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { reject: false });
      await proc.catch(() => {});
      return;
    }
    proc.kill('SIGTERM');
    await Promise.race([proc.catch(() => {}), sleep(3000)]);
    if (proc.exitCode === undefined || proc.exitCode === null) {
      proc.kill('SIGKILL');
      await proc.catch(() => {});
    }
  } catch {
    // already dead
  }
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('Could not allocate a port')));
      }
    });
    srv.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
