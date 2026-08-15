// Generates schema/paxcli.config.schema.json from the zod schema — the
// single source of truth. Run after changing src/config/schema.ts:
//   npm run build && npm run schema
import { mkdirSync, writeFileSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { paxcliConfigSchema } from '../dist/index.js';

const schema = zodToJsonSchema(paxcliConfigSchema, {
  name: 'PaxcliConfig',
  $refStrategy: 'none',
});
schema.title = 'paxcli.config.json';
schema.description =
  'Configuration for paxcli — verified autonomous code optimization. Docs: https://github.com/harikantbajaj/paxcli/blob/main/docs/quickstart.md';

mkdirSync('schema', { recursive: true });
writeFileSync('schema/paxcli.config.schema.json', JSON.stringify(schema, null, 2));
console.log('schema/paxcli.config.schema.json written');
