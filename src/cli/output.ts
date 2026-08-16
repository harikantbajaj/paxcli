import pc from 'picocolors';
import { PaxcliError } from '../util/errors.js';

/**
 * Output contract: with --json, stdout carries exactly one machine-readable
 * JSON document and all progress goes to stderr; without it, humans get
 * plain-English status lines. That contract includes failures: a --json
 * invocation that fails still emits one structured document on stdout.
 */
export class Output {
  constructor(readonly json: boolean) {}

  status(msg: string): void {
    if (this.json) {
      process.stderr.write(`${msg}\n`);
    } else {
      console.log(`${pc.dim('•')} ${msg}`);
    }
  }

  info(msg: string): void {
    if (this.json) process.stderr.write(`${msg}\n`);
    else console.log(msg);
  }

  error(msg: string): void {
    process.stderr.write(`${pc.red('error:')} ${msg}\n`);
  }

  /** Final machine-readable result (stdout). No-op unless --json. */
  result(payload: Record<string, unknown>): void {
    if (this.json) {
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...payload }, null, 2)}\n`);
    }
  }

  /**
   * Terminal failure: human-readable error (+ repair hint) on stderr, and —
   * under --json — a structured failure document on stdout so machine
   * consumers never have to parse stderr. Returns the exit code to set.
   */
  failure(err: unknown): number {
    const isPax = err instanceof PaxcliError;
    const message = err instanceof Error ? err.message : String(err);
    const hint = isPax ? err.hint : null;
    this.error(message);
    if (hint) process.stderr.write(`${pc.dim('fix:')} ${hint}\n`);
    if (this.json) {
      process.stdout.write(
        `${JSON.stringify(
          { schemaVersion: 1, ok: false, code: isPax ? err.code : 'internal', message, hint },
          null,
          2,
        )}\n`,
      );
    }
    return isPax ? err.exitCode : 1;
  }
}
