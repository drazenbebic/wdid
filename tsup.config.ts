import { defineConfig } from 'tsup';

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
});
