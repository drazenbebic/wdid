import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import 'dotenv/config';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

// Build-time OAuth client credentials. tsup substitutes these literals into
// dist/index.js. Empty strings are valid at build time (e.g. CI without
// secrets) — the runtime code falls back to config/env-var overrides, so the
// distributed binary still works for users who BYO their own OAuth client.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';

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
    __GOOGLE_CLIENT_ID__: JSON.stringify(GOOGLE_CLIENT_ID),
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(GOOGLE_CLIENT_SECRET),
  },
});
