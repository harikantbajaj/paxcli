import pc from 'picocolors';

/**
 * Output contract: with --json, stdout carries exactly one machine-readable
 * JSON document and all progress goes to stderr; without it, humans get
 * plain-English status lines.
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
}
