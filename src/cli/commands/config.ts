import type { Command } from 'commander';
import pc from 'picocolors';
import { CONFIG_FILENAME, loadConfig } from '../../config/schema.js';
import { guard } from '../helpers.js';
import { Output } from '../output.js';

/** `paxcli config …` — configuration tools. */
export function registerConfigCommands(program: Command): void {
  const configCmd = program.command('config').description('Configuration tools');

  configCmd
    .command('validate')
    .description(`Validate ${CONFIG_FILENAME}`)
    .option('--json', 'machine-readable output on stdout')
    .action(async (opts: { json?: boolean }) => {
      const out = new Output(Boolean(opts.json));
      await guard(out, async () => {
        await loadConfig(process.cwd());
        out.info(pc.green(`✓ ${CONFIG_FILENAME} is valid`));
        out.result({ valid: true });
      });
    });
}
