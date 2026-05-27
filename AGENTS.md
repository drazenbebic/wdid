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
- **Lint/format**: ESLint 10 flat config (`eslint.config.js`) + Prettier. Prettier config lives in `.prettierrc.json` — don't silently change keys.
- **Tests**: Vitest. Files live next to source as `*.test.ts`.
- **Commits**: Conventional Commits (required for release-please to work). `feat:`, `fix:`, `chore:`, etc. Breaking changes via `!` or `BREAKING CHANGE:` footer.

## How releasing works

1. Merge Conventional Commits to `main`.
2. `release-please` opens (or updates) a release PR that bumps `package.json` + `.release-please-manifest.json` and regenerates `CHANGELOG.md`.
3. Merging that release PR creates a GitHub Release.
4. The `publish` job in `release-please.yml` runs only when `release_created == 'true'`, then `npm publish --provenance --access public` (npm, not pnpm — see "Easy to get wrong" below).

**Authentication**: npm Trusted Publishing (OIDC). No `NPM_TOKEN` secret — the `id-token: write` permission lets `npm publish` exchange a GitHub-signed OIDC token for a short-lived npm token automatically. The trust relationship is configured on the npm package page (org `drazenbebic`, repo `wdid`, workflow `release-please.yml`, no GitHub Environment). If the workflow filename, repo name, or org name changes, the npm-side config must change too or publishes will start failing.

If you ever change the package name, update it in **three** places: `package.json#name`, `release-please-config.json#packages."."`.`package-name`, and the README install snippet.

## CLI design notes

- The bash original took a single optional date arg or the literal `today`. The TS version preserves that and adds `--from`, `--to`, `--author`, `--repo <path...>`, `--format`, `--ticket-pattern`.
- A positional date narrows both `--from` and `--to` to the same day. Mixing `[date]` with `--from/--to` lets the positional win (intentional; matches the bash behavior).
- Ticket extraction is **configurable** via `src/config.ts` presets (`jira`, `github`, `conventional`, `custom`). The JIRA preset is the default. The first regex match wins; the first capture group is preferred, falling back to the full match for capture-group-less custom regexes.
- The description column is the **full** commit subject, including the `(TICKET)` part — the user explicitly chose this in the scoping question.
- `git log` is invoked with `execFile` (not `exec`) to avoid shell injection on the author argument. Don't refactor to a shell-string form.
- `git log` is called with `--exclude=refs/stash --all`. Without the exclude, `git stash` entries show up as commits — they're authored by the user, so they pass `--author=`, and their subjects (`On <branch>: ...` / `index on <branch>: ...`) confuse both the ticket regex and per-ticket aggregation. Don't drop the exclude.

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
- **Toggl integration lives in `src/integrations/toggl.ts`** (planner is pure, `fetchSyncedShas`/`pushEntries` are the network calls). Auth is `Basic base64(<token>:api_token)` — non-obvious. The CLI subcommand is `wdid toggl sync [date]` (commander nested command); `--dry-run` works even without a token (existingSyncedShas is empty, plan looks "all new").
- **Toggl idempotency uses multi-SHA markers.** Each entry's description ends with one `(wdid <7-char-sha>)` marker per included commit, e.g. `EN-4435: a; b (wdid abc1234) (wdid def5678)`. `extractSyncedShasFromDescription` uses `matchAll` to pull them all; the planner marks a _group_ as `alreadySynced` only when _every_ SHA in the group is already known to Toggl. Don't change the marker format casually — already-synced entries on real Toggl accounts will start re-syncing.
- **`program.enablePositionalOptions()` is load-bearing.** The root `wdid` command defines `--from` / `--to` / `--author` for the table flow; the `toggl sync` subcommand also defines them. Without `enablePositionalOptions`, commander hands options to the parent before the subcommand sees them, so `wdid toggl sync --from X --to Y` silently runs against the parent's options and the subcommand sees nothing. Don't remove the call.
- **Toggl descriptions are condensed via `cleanSubjectForToggl`** in `src/integrations/toggl.ts`: strips the conventional-commit prefix and any redundant leading ticket reference, then the planner prepends `${ticket}: ` once for the whole group. This matches what users want to see in Toggl — `EN-4435: remove requestBody` rather than `chore(EN-4435): remove requestBody`. If you ever add a non-conventional commit style to support, extend this function rather than bypassing it.
- **Default Toggl granularity is per-ticket** (`togglOneEntryPerTicket: true`). Commits sharing a ticket collapse into a single entry whose `durationSeconds = count × defaultDurationSeconds`. Commits without a ticket stay 1:1. Default `togglIgnoreSubjectPattern` is `\bmerge\b` (case-insensitive) to skip git's auto-generated merge commits.
- **`customPattern` is intentional user-supplied regex.** CodeQL flags `new RegExp(customPattern)` in `src/config.ts` as a regex-injection sink — that's expected. The whole point of `format: "custom"` is to accept a user regex; escaping it would defeat the feature. The mitigation is `MAX_CUSTOM_PATTERN_LENGTH` (length-cap at both config-load and compile-time) plus the `lgtm[js/regex-injection]` suppression at the compile site. Don't remove the suppression comment or the length cap.
- **Branch annotation in the Description column** uses `git name-rev --stdin --refs='refs/heads/*'` (one batched call per repo, not per commit) and skips `main`/`master` via `TRUNK_BRANCHES` in `src/git.ts`. The `--stdin` output format is `"<sha> (<name>)"` — don't try to switch to `--name-only --stdin` for "speed", you'll lose the sha→name mapping. `name-rev` returns suffixes like `feat/login~3` (3 commits before the tip); `normalizeBranchName` strips `~N`/`^N`. If users want to skip more "trunks" (e.g. `develop`), make `TRUNK_BRANCHES` configurable rather than enlarging the hardcoded set.
- **`@types/node` is pinned to `^20.x`** on purpose — it must track the `engines.node` floor, not the latest Node. Bumping it (e.g. to `^25`) would silently make Node-22+/25+ APIs look type-safe, then crash at runtime on Node 20. When raising the floor, raise both together. `pnpm update --latest` doesn't know this rule, so re-pin after running it.
- **`eslint-config-prettier` must come BEFORE our project rules in `eslint.config.js`**, not after. It disables 350+ rules including `curly` defensively — putting our custom rules last lets us re-enable the ones we actually want. If you ever see "I enabled rule X but it doesn't fire", check the config order first.
- **Pre-commit hook (`.husky/pre-commit`)** runs `pnpm exec lint-staged`. The `lint-staged` config in `package.json` runs `eslint --fix` + `prettier --write` on staged TS/JS, and `prettier --write` on staged JSON/Markdown/YAML. The `prepare: husky` script installs the hook on `pnpm install`. If the hook ever silently stops firing on a new clone, run `pnpm install` again or `pnpm exec husky` directly.

## Tasks the user has asked for explicitly

- Keep the binary name exactly `wdid` (mapped via `bin.wdid` in `package.json`).
- Don't change the Prettier config above.
- Maintain compatibility down to Node 20.

## Out of scope (do not add unprompted)

- Other API integrations beyond Toggl (JIRA, Linear, etc.). `src/integrations/` is the home for these when they happen, but each one needs its own scoping conversation.
- HTML/Markdown export. `--json` is supported (for piping to `jq` and scripts), but additional formatters haven't been asked for.
- Per-repo config files. CLI flags are the configuration surface.

## How to update this file

Append rather than rewrite when the change is additive. Reorganize sections only when the structure genuinely no longer fits. If you contradict an earlier statement, **remove the old one** rather than leaving both — future agents will get confused by conflicting guidance.
