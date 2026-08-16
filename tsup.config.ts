import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    index: 'src/index.ts',
    hosts: 'src/hosts/index.ts',
    proof: 'src/proof/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: {
    entry: {
      index: 'src/index.ts',
      hosts: 'src/hosts/index.ts',
      proof: 'src/proof/index.ts',
    },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  banner: ({ format }) => (format === 'esm' ? { js: '' } : {}),
});
