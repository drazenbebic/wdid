# AGENTS.md

Living notes for AI agents working on this repo. Update this file when you learn something a future agent would benefit from. Prefer durable facts and conventions; skip ephemeral task notes.

## What this project is

`@drazenbebic/wdid` — a TypeScript CLI that wraps `git log` and prints a colored table of the user's commits per day, grouped by JIRA-style ticket. It exists to help the maintainer reconstruct what they worked on when filling out Toggl timesheets.

The original tool was a tiny shell function (still in the user's first message); this repo reimplements it as a publishable npm binary with multi-repo support, date ranges, and an author override.

## Stack & conventions

- **Language**: TypeScript, ESM only (`"type": "module"`).
- **Package manager**: pnpm (pinned via `packageManager` in `package.json`). Don't reintroduce npm/yarn artifacts — no `package-lock.json`, no `yarn.lock`.
- **Bundler**: `tsup` → one ESM file at `dist/index.js` with a `#!/usr/bin/env node` shebang. The shebang is injected via tsup's `banner.js`, not by hand.
- **Target / min Node**: `engines.node = ">=20"`, tsup `target: "node20"`. CI matrix tests on **20, 22, 24, 26**. If you raise the floor, update all three places + the README.
- **Lint/format**: ESLint 9 flat config (`eslint.config.js`) + Prettier. Prettier config is exact and chosen by the user — don't change keys silently:
  ```json
  {
    "printWidth": 80,
    "endOfLine": "auto",
    "arrowParens": "avoid",
    "trailingComma": "all",
    "semi": true,
    "singleQuote": true,
    "useTabs": false,
    "bracketSpacing": true
  }
  ```
- **Tests**: Vitest. Files live next to source as `*.test.ts`.
- **Commits**: Conventional Commits (required for release-please to work). `feat:`, `fix:`, `chore:`, etc. Breaking changes via `!` or `BREAKING CHANGE:` footer.

## Repo layout

```
src/
  index.ts      # commander CLI entry, glues git + format
  git.ts        # spawns `git log`, parses output, extracts JIRA tickets
  format.ts     # cli-table3 + chalk rendering
  git.test.ts   # vitest unit tests for extractTicket
tsup.config.ts          # build config; injects shebang
vitest.config.ts        # test config
eslint.config.js        # flat ESLint config
.prettierrc.json
release-please-config.json
.release-please-manifest.json
.github/workflows/
  ci.yml             # PR/push: check (typecheck/lint/format) + matrix test
  release-please.yml # main: opens release PRs, publishes to npm on release
```

## How releasing works

1. Merge Conventional Commits to `main`.
2. `release-please` opens (or updates) a release PR that bumps `package.json` + `.release-please-manifest.json` and regenerates `CHANGELOG.md`.
3. Merging that release PR creates a GitHub Release.
4. The `publish` job in `release-please.yml` runs only when `release_created == 'true'`, then `pnpm publish --provenance --access public`.

**Authentication**: npm Trusted Publishing (OIDC). No `NPM_TOKEN` secret — the `id-token: write` permission lets `pnpm publish` exchange a GitHub-signed OIDC token for a short-lived npm token automatically. The trust relationship is configured on the npm package page (org `drazenbebic`, repo `wdid`, workflow `release-please.yml`, no GitHub Environment). If the workflow filename, repo name, or org name changes, the npm-side config must change too or publishes will start failing.

If you ever change the package name, update it in **three** places: `package.json#name`, `release-please-config.json#packages."."`.`package-name`, and the README install snippet.

## CLI design notes

- The bash original took a single optional date arg or the literal `today`. The TS version preserves that and adds `--from`, `--to`, `--author`, `--repo <path...>`, `--format`, `--ticket-pattern`.
- A positional date narrows both `--from` and `--to` to the same day. Mixing `[date]` with `--from/--to` lets the positional win (intentional; matches the bash behavior).
- Ticket extraction is **configurable** via `src/config.ts` presets (`jira`, `github`, `conventional`, `custom`). The JIRA preset is the default. The first regex match wins; the first capture group is preferred, falling back to the full match for capture-group-less custom regexes.
- The description column is the **full** commit subject, including the `(TICKET)` part — the user explicitly chose this in the scoping question.
- `git log` is invoked with `execFile` (not `exec`) to avoid shell injection on the author argument. Don't refactor to a shell-string form.

## Configuration

`src/config.ts` handles loading, validation, and `~` expansion.

- **Resolution order**: CLI flags > repo-level config (via `cosmiconfig`, searches up from cwd) > global config (`$XDG_CONFIG_HOME/wdid/config.json`, defaulting to `~/.config/wdid/config.json`) > built-in defaults.
- **Configs do not merge across levels** — the first found wins in full. This is intentional; merging makes precedence opaque. If you want to override one field, copy the whole config.
- **Validation** is hand-rolled in `validateConfig`. If the schema grows beyond ~6 fields, switch to zod rather than letting the manual validator sprawl.
- **Custom-format precedence on the CLI**: `--ticket-pattern` implies `--format custom` and overrides `--format`. Document this in any new help text.

## Personal data policy

The user operates under an organization policy that prohibits personal data in responses. When generating files that would normally contain author info (`package.json#author`, `LICENSE` copyright line, repo URLs), use **placeholders** (`Your Name <you@example.com>`, `your-org/wdid`) and flag them to the user so they can replace with real values. Don't echo their real name/email back from past file contents either.

## Things that are easy to get wrong

- **ESM `.js` imports in TS source**: `import { foo } from "./bar.js"` even though the file is `bar.ts`. This is required by `moduleResolution: "Bundler"` + ESM output. Don't "fix" them.
- **Don't add a `dist/` to git**. It's `.gitignore`d and built fresh in CI before publish.
- **Don't bump deps casually**. The CI matrix tests on Node 20; some newer transitive deps may drop 20. If a dep upgrade breaks Node 20, prefer pinning the dep over raising the floor unless the user agreed.
- **The release workflow uses `npm publish`, not `pnpm publish`**, even though pnpm is used everywhere else. Reason: npm Trusted Publishing requires the OIDC token exchange, which is only implemented in npm CLI ≥ 11.5.1 (bundled with Node ≥ 24). pnpm publish skips the exchange entirely and the registry rejects the unauthenticated PUT with a misleading 404. Don't try to "consolidate" to pnpm here until pnpm gains OIDC support. The publish job's Node version is pinned to 24 specifically to get a recent enough bundled npm.
- **`package.json` `repository.url` MUST match the GitHub repo where the workflow runs** when publishing with provenance. npm cross-checks it against the OIDC attestation and returns a 422 if they differ. If you rename the repo or move it to a different org, update `repository.url`, `bugs.url`, and `homepage` at the same time — `bugs` and `homepage` aren't validated but visibly drift on the npm page.
- **PR title check (`.github/workflows/pr-title.yml`)** validates the squash-merge title against Conventional Commits via `amannn/action-semantic-pull-request@v6`. If you add a new commit type to `release-please-config.json` `changelog-sections`, also add it to the `types:` list in that workflow — otherwise PRs using the new type will fail the check.
- **release-please pre-1.0 bump flags are confusingly named** and do opposite things:
  - `bump-minor-pre-major: true` — `BREAKING CHANGE` → minor (instead of jumping to 1.0.0). We want this on while pre-1.0.
  - `bump-patch-for-minor-pre-major: true` — `feat:` → patch (instead of the usual minor). We do NOT want this on; it makes every feat a patch bump. Don't add it back unless you genuinely want "all pre-1.0 changes are patch".
- **Branch annotation in the Description column** uses `git name-rev --stdin --refs='refs/heads/*'` (one batched call per repo, not per commit) and skips `main`/`master` via `TRUNK_BRANCHES` in `src/git.ts`. The `--stdin` output format is `"<sha> (<name>)"` — don't try to switch to `--name-only --stdin` for "speed", you'll lose the sha→name mapping. `name-rev` returns suffixes like `feat/login~3` (3 commits before the tip); `normalizeBranchName` strips `~N`/`^N`. If users want to skip more "trunks" (e.g. `develop`), make `TRUNK_BRANCHES` configurable rather than enlarging the hardcoded set.
- **`@types/node` is pinned to `^20.x`** on purpose — it must track the `engines.node` floor, not the latest Node. Bumping it (e.g. to `^25`) would silently make Node-22+/25+ APIs look type-safe, and they'd then crash on Node 20 at runtime. When raising the floor, raise both together.
- **After running `pnpm update --latest`**, always re-pin `@types/node` back to the floor — `update --latest` doesn't know about this rule.
- **`eslint-config-prettier` must come BEFORE our project rules in `eslint.config.js`**, not after. It disables 350+ rules including `curly` defensively — putting our custom rules last lets us re-enable the ones we actually want. If you ever see "I enabled rule X but it doesn't fire", check the config order first.
- **Pre-commit hook (`.husky/pre-commit`)** runs `pnpm exec lint-staged`. The `lint-staged` config in `package.json` runs `eslint --fix` + `prettier --write` on staged TS/JS, and `prettier --write` on staged JSON/Markdown/YAML. The `prepare: husky` script installs the hook on `pnpm install`. If the hook ever silently stops firing on a new clone, run `pnpm install` again or `pnpm exec husky` directly.

## Tasks the user has asked for explicitly

- Keep the binary name exactly `wdid` (mapped via `bin.wdid` in `package.json`).
- Don't change the Prettier config above.
- Maintain compatibility down to Node 20.

## Out of scope (do not add unprompted)

- Authentication-required integrations (Toggl API, JIRA API) — the user wanted this purely git-based.
- HTML/Markdown export. `--json` is supported (for piping to `jq` and scripts), but additional formatters haven't been asked for.
- Per-repo config files. CLI flags are the configuration surface.

## How to update this file

Append rather than rewrite when the change is additive. Reorganize sections only when the structure genuinely no longer fits. If you contradict an earlier statement, **remove the old one** rather than leaving both — future agents will get confused by conflicting guidance.
