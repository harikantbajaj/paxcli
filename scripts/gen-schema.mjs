// Generates the public JSON schemas from the zod schemas — the single source
// of truth. Run after changing src/config/schema.ts or src/ledger/schema.ts:
//   npm run build && npm run schema
import { mkdirSync, writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ledgerEntrySchema, paxcliConfigSchema, receiptSchema } from '../dist/index.js';

mkdirSync('schema', { recursive: true });

const config = zodToJsonSchema(paxcliConfigSchema, {
  name: 'PaxcliConfig',
  $refStrategy: 'none',
});
config.title = 'paxcli.config.json';
config.description =
  'Configuration for paxcli — verified autonomous code optimization. Docs: https://github.com/harikantbajaj/paxcli/blob/main/docs/quickstart.md';
writeFileSync('schema/paxcli.config.schema.json', JSON.stringify(config, null, 2));
console.log('schema/paxcli.config.schema.json written');

// The Proof Ledger entry — the stable, public shape of the machine-readable
// receipts embedded in PROOF.md. Versioned via ledgerEntryVersion.
const ledger = zodToJsonSchema(ledgerEntrySchema, {
  name: 'PaxcliLedgerEntry',
  $refStrategy: 'none',
});
ledger.title = 'Proof Ledger entry';
ledger.description =
  'One machine-readable entry of a paxcli Proof Ledger (PROOF.md). Optimization entries carry the verified vocabulary; task entries only ever say "checks passed" or "applied — not verified by paxcli".';
writeFileSync('schema/paxcli.ledger-entry.schema.json', JSON.stringify(ledger, null, 2));
console.log('schema/paxcli.ledger-entry.schema.json written');

// The receipt — the reproducible evidence behind every accepted or rejected
// experiment, and the seed of the Proof API. Versioned via receiptVersion.
const receipt = zodToJsonSchema(receiptSchema, {
  name: 'PaxcliReceipt',
  $refStrategy: 'none',
});
receipt.title = 'paxcli receipt';
receipt.description =
  'One experiment receipt: commits, hypothesis, gates, measurements, withheld/reproduction evidence, and the decision. Written under .paxcli/runs/<run>/receipts/; the .redacted.json variant is the shareable one.';
writeFileSync('schema/paxcli.receipt.schema.json', JSON.stringify(receipt, null, 2));
console.log('schema/paxcli.receipt.schema.json written');
