/**
 * Error taxonomy: every user-facing failure carries a stable machine code,
 * an exit code, and (wherever possible) a doctor-style hint with the exact
 * repair step. `guard` in the CLI turns these into consistent human output
 * and, under --json, a structured failure document on stdout.
 */

export type PaxcliErrorCode =
  | 'config'
  | 'host-unavailable'
  | 'benchmark-unstable'
  | 'git-state'
  | 'not-found'
  | 'internal';

export class PaxcliError extends Error {
  readonly code: PaxcliErrorCode;
  readonly exitCode: number;
  /** Exact repair step shown under the error message. */
  readonly hint: string | null;

  constructor(
    message: string,
    opts: { code?: PaxcliErrorCode; exitCode?: number; hint?: string } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code ?? 'internal';
    this.exitCode = opts.exitCode ?? 1;
    this.hint = opts.hint ?? null;
  }
}

export class ConfigError extends PaxcliError {
  constructor(message: string, hint?: string) {
    super(message, { code: 'config', ...(hint ? { hint } : {}) });
  }
}

export class HostUnavailableError extends PaxcliError {
  constructor(message: string, hint?: string) {
    super(message, { code: 'host-unavailable', ...(hint ? { hint } : {}) });
  }
}

export class BenchmarkUnstableError extends PaxcliError {
  constructor(message: string, hint?: string) {
    super(message, { code: 'benchmark-unstable', ...(hint ? { hint } : {}) });
  }
}

export class GitStateError extends PaxcliError {
  constructor(message: string, hint?: string) {
    super(message, { code: 'git-state', ...(hint ? { hint } : {}) });
  }
}

export class NotFoundError extends PaxcliError {
  constructor(message: string, hint?: string) {
    super(message, { code: 'not-found', ...(hint ? { hint } : {}) });
  }
}
