import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import 'dotenv/config';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

// Build-time OAuth client credentials. tsup substitutes these literals into
// dist/index.js. Empty strings are valid at build time (e.g. local dev
// without a .env, or `ci.yml`'s test matrix) — the runtime code falls back to
// config/env-var overrides, so the distributed binary still works for users
// who BYO their own OAuth client.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';

// The release-please publish workflow sets WDID_PUBLISH_BUILD=true. When it
// does, missing credentials are a hard error — silently shipping a bundle
// with empty defaults means everyone who installs from npm has to BYO and
// the release is effectively broken. This guard catches the failure mode at
// build time, before the bad bundle ever hits the registry.
if (
  process.env.WDID_PUBLISH_BUILD === 'true' &&
  (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
) {
  throw new Error(
    'Publish build: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not in the ' +
      'environment. Check that both repository secrets exist in GitHub ' +
      'Settings → Secrets and variables → Actions, and that the release ' +
      'workflow exposes them via an `env:` block on the build step.',
  );
}

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
