<div align="center">
    <picture>
        <source
            srcset="./logos/wdid_logo_white_transparent.png"
            media="(prefers-color-scheme: dark)"
            width="820" height="332"
        />
        <img
            src="./logos/wdid_logo_black_transparent.png"
            alt="What did I do Logo"
            width="820" height="332"
        />
    </picture>
</div>

> What did I do? — a small CLI that summarizes your git activity as a tidy table, so you can fill in your timesheet without trying to remember Tuesday.

`wdid` reads `git log` for your author across one or more repos and renders the output as a colorized table with **Date** (with commit time, shown in your local timezone), **Ticket** (JIRA-style `ABC-123` by default, parsed from the commit subject), and **Description**.

## Install

```sh
npm install -g @drazenbebic/wdid
```

This puts a `wdid` binary on your `PATH`.

## Usage

```sh
wdid                       # show help (no args = nothing to do)
wdid today                 # commits from today
wdid yesterday             # commits from yesterday
wdid 2026-05-27            # commits from a specific day (YYYY-MM-DD)
wdid 2026-05               # commits from a specific month (YYYY-MM)
wdid --from 2026-05-01 --to 2026-05-07   # a date range
wdid --all                 # all commits, no date filter
wdid --author "Jane Doe"   # someone else's commits
wdid --repo ../api ../web  # query multiple repos at once
```

By default `wdid` uses `git config user.name` as the author and the current working directory as the repo.

### Example output

```
┌──────────────────┬──────────────┬──────────────────────────────────────────────────┐
│ Date             │ Ticket       │ Description                                      │
├──────────────────┼──────────────┼──────────────────────────────────────────────────┤
│ 2026-05-27 16:42 │ ABC-123      │ feat(ABC-123): add login flow                    │
│ 2026-05-27 11:08 │ —            │ chore: bump deps                                 │
│ 2026-05-26 17:53 │ ABC-119      │ fix(ABC-119): handle empty payload               │
└──────────────────┴──────────────┴──────────────────────────────────────────────────┘
```

The time is rendered dimmed and shown in your local timezone (parsed from the committer's full ISO timestamp).

If a commit doesn't reference a ticket, the Ticket column is left blank (rendered as `—`).

With `--group-by-day`, the date moves into a section heading instead of repeating per row, making longer outputs feel more like a journal:

```
┌───────┬──────────────┬─────────────────────────────────────┐
│ Time  │ Ticket       │ Description                         │
├───────┴──────────────┴─────────────────────────────────────┤
│ 2026-05-27                                                 │
├───────┬──────────────┬─────────────────────────────────────┤
│ 16:42 │ ABC-123      │ feat(ABC-123): add login flow       │
│ 11:08 │ —            │ chore: bump deps                    │
├───────┴──────────────┴─────────────────────────────────────┤
│ 2026-05-26                                                 │
├───────┬──────────────┬─────────────────────────────────────┤
│ 17:53 │ ABC-119      │ fix(ABC-119): handle empty payload  │
└───────┴──────────────┴─────────────────────────────────────┘
```

## Options

| Option                     | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `[date]`                   | A `YYYY-MM-DD` date, a `YYYY-MM` month, or the literal `today` / `yesterday`.                |
| `--all`                    | Show all history (no date filter). Required to opt into the unfiltered view explicitly.      |
| `--from <date>`            | Start date (inclusive).                                                                      |
| `--to <date>`              | End date (inclusive).                                                                        |
| `--author <name>`          | Override the git author. Defaults to `git config user.name` (or `defaultAuthor` in config).  |
| `--repo <path...>`         | One or more repo paths to query. Defaults to `defaultRepos` in config, then the current dir. |
| `--format <preset>`        | Ticket format: `jira`, `github`, `conventional`, or `custom`. Defaults to `jira`.            |
| `--ticket-pattern <regex>` | Custom regex for ticket extraction. Implies `--format custom`; overrides `--format`.         |
| `--no-color`               | Disable colored output. Also honored via the `NO_COLOR` env var.                             |
| `--limit <N>`              | Cap the table to the most recent `N` rows. Positive integer.                                 |
| `--group-by-day`           | Group rows under a bold date heading per day; the row only shows the time.                   |
| `--json`                   | Emit a JSON array of commit entries to stdout instead of the table. Empty result is `[]`.    |

## Configuration

`wdid` looks for a config file in this order:

1. **Repo-level** (current directory and walking up): `wdid.config.{js,cjs,mjs,ts,json,yaml,yml}`, `.wdidrc{,.json,.yaml,.yml,.js,.cjs}`, or a `"wdid"` field in `package.json`.
2. **Global**: `~/.config/wdid/config.json` (honors `XDG_CONFIG_HOME`).

CLI flags always win. The first match in this list is used in full (configs do not merge across levels).

### Schema

```json
{
  "format": "jira",
  "customPattern": "^\\[([A-Z]+-\\d+)\\]",
  "defaultAuthor": "Jane Doe",
  "defaultRepos": ["~/work/api", "~/work/web"]
}
```

| Field               | Type                                               | Description                                                                        |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `format`            | `"jira" \| "github" \| "conventional" \| "custom"` | Ticket extraction preset. Default `jira`.                                          |
| `customPattern`     | `string`                                           | Regex used when `format` is `"custom"`. First capture group wins, else full match. |
| `defaultAuthor`     | `string`                                           | Used when `--author` is not passed and you want to skip the `git config` lookup.   |
| `defaultRepos`      | `string[]`                                         | Paths to query when no `--repo` is given. `~` is expanded.                         |
| `ticketColumnLabel` | `string`                                           | Override the auto-picked column header (see below).                                |

### Format presets

| Preset         | Matches                                          | Example commit → match                 | Column header |
| -------------- | ------------------------------------------------ | -------------------------------------- | ------------- |
| `jira`         | `ABC-123` style (uppercase project key + digits) | `feat(ABC-123): add login` → `ABC-123` | `Ticket`      |
| `github`       | `#123` style                                     | `Closes #42` → `42`                    | `Issue`       |
| `conventional` | Conventional Commit `type(scope)!`               | `feat(auth)!: ...` → `feat(auth)!`     | `Type`        |
| `custom`       | Your `customPattern` regex                       | depends on the regex                   | `Match`       |

The column header is picked automatically based on the active format. To override it for a specific preset (e.g. call them "Tasks" instead of "Ticket"), set `ticketColumnLabel` in your config.

## Toggl integration

`wdid toggl sync [date]` pushes the day's commits to Toggl as time entries. By default, commits with the same ticket are **collapsed into a single entry** (duration scales with commit count) and commits whose subject matches `\bmerge\b` are skipped. Entries stack from a configurable day-start hour — you adjust the exact times in Toggl yourself. The sync is **idempotent**: each entry's description carries one `(wdid <short-sha>)` marker per included commit, and re-running skips commits already pushed.

Descriptions are condensed for Toggl: the conventional-commit prefix (`feat:`, `chore(ABC-123):`, `fix!:`, etc.) is stripped, and the ticket — if any — is prepended once. So `chore(EN-4435): remove requestBody` becomes `EN-4435: remove requestBody`. Aggregated entries look like `EN-4435: subject A; subject B; subject C`.

```sh
wdid toggl sync                                      # push today
wdid toggl sync 2026-05-27                           # push a specific day
wdid toggl sync today --dry-run                      # preview without pushing
wdid toggl sync --workspace 12345 today              # override the configured workspace
wdid toggl sync --from 2026-05-25 --to 2026-05-27    # push a multi-day range (inclusive)
```

`--from` and `--to` are inclusive and mutually exclusive with the positional `[date]`. Each day is planned independently (its own 09:00 start, its own dedup fetch). On a per-day failure (Toggl 500, missing project, etc.), the sync continues through the remaining days and exits non-zero with a summary so one bad day doesn't strand the rest. The range is capped at 366 days as a guardrail.

### Toggl config

Add these alongside the other config fields:

```json
{
  "togglApiToken": "your-api-token",
  "togglWorkspaceId": 12345,
  "togglProjects": {
    "ABC-": 67890,
    "DEF-": 67891
  },
  "togglDefaultProjectId": 99999,
  "togglDefaultDurationMinutes": 30,
  "togglDayStartHour": 9,
  "togglOneEntryPerTicket": true,
  "togglIgnoreSubjectPattern": "\\bmerge\\b"
}
```

| Field                         | Type                     | Description                                                                                                 |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `togglApiToken`               | `string`                 | Toggl API token (find it in Toggl → Profile → API Token). Prefer the `TOGGL_API_TOKEN` env var.             |
| `togglWorkspaceId`            | `number`                 | Numeric Toggl workspace ID. Required to push.                                                               |
| `togglProjects`               | `Record<string, number>` | Map of ticket-prefix → project ID. Longest matching prefix wins.                                            |
| `togglDefaultProjectId`       | `number`                 | Project ID for commits that don't match any prefix (or have no ticket).                                     |
| `togglDefaultDurationMinutes` | `number`                 | Per-commit duration. Default `30`. In per-ticket mode, an entry's total duration is `count × this`.         |
| `togglDayStartHour`           | `number` (0–23)          | Hour to start stacking entries at. Default `9` (09:00).                                                     |
| `togglOneEntryPerTicket`      | `boolean`                | When `true` (default), commits sharing a ticket collapse into one entry. Commits without a ticket stay 1:1. |
| `togglIgnoreSubjectPattern`   | `string` (regex)         | Subjects matching this pattern (case-insensitive) are skipped. Default `\bmerge\b`. Set to `""` to disable. |

### Auth

The API token is resolved in this order: `TOGGL_API_TOKEN` env var > `togglApiToken` in config. The env var path is preferred so you don't have to commit (or remember not to commit) the token.

## Managing config

`wdid config` provides four subcommands for the **global** config (`~/.config/wdid/config.json` — honors `XDG_CONFIG_HOME`). Repo-level configs are read but not written by these commands; edit them by hand.

```sh
wdid config set togglApiToken tok_…                # set a scalar field
wdid config set togglWorkspaceId 12345             # numbers are parsed
wdid config set togglOneEntryPerTicket false       # booleans take "true"/"false"
wdid config set togglProjects.ABC- 67890           # set a nested record entry
wdid config get togglApiToken                      # secrets are masked
wdid config get togglApiToken --show-secrets       # …unless --show-secrets
wdid config list                                   # all set fields, aligned, secrets masked
wdid config list --show-secrets                    # reveal secrets
wdid config path                                   # absolute path to the config file
wdid config repo add ~/work/api                    # append to defaultRepos
wdid config repo remove ~/work/api                 # remove from defaultRepos
wdid config repo list                              # show configured repo paths
```

Notes:

- **Validation runs at `set` time** — `wdid config set togglDayStartHour 99` fails immediately with the schema error, the file is never touched.
- **Secrets are masked** in `list` / `get` output (`tok_…wa9e0d` style) unless `--show-secrets` is set.
- **`defaultRepos` has its own subcommands.** `wdid config set` only handles scalars; use `wdid config repo add <path>` / `remove <path>` / `list`. Paths under `$HOME` are stored in their `~/…` form for portability, and `add` rejects non-existent paths.
- **To remove a key**, edit the file directly — `unset` isn't included in this slice.

## Development

This project uses [pnpm](https://pnpm.io) (see the `packageManager` field in `package.json`).

```sh
pnpm install
pnpm run build      # bundle to dist/index.js with tsup
pnpm run dev        # watch mode
pnpm run typecheck  # tsc --noEmit
pnpm run lint       # eslint
pnpm run format     # prettier --write .
node dist/index.js today
```

## Releasing

This repo uses [release-please](https://github.com/googleapis/release-please) to manage versions and changelogs. Merge a [Conventional Commit](https://www.conventionalcommits.org/) to `main` (e.g. `feat: ...`, `fix: ...`) and release-please will open a release PR; merging that PR cuts a release and publishes to npm via GitHub Actions.

## License

[MIT](./LICENSE)
