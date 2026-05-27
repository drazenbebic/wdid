import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  minify: false,
  sourcemap: false,
  shims: false,
  banner: { js: '#!/usr/bin/env node' },
  outDir: 'dist',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});
