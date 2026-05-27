# wdid

> What did I do? — a small CLI that summarizes your git activity as a tidy table, so you can fill in your timesheet without trying to remember Tuesday.

`wdid` reads `git log` for your author across one or more repos and renders the output as a colorized table with **Date** (with commit time, shown in your local timezone), **Ticket** (JIRA-style `ABC-123` by default, parsed from the commit subject), and **Description**.

## Install

```sh
npm install -g @drazenbebic/wdid
```

This puts a `wdid` binary on your `PATH`.

## Usage

```sh
wdid                       # all commits authored by you, across all branches
wdid today                 # commits from today
wdid 2026-05-27            # commits from a specific day (YYYY-MM-DD)
wdid --from 2026-05-01 --to 2026-05-07   # a date range
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

## Options

| Option                     | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `[date]`                   | A `YYYY-MM-DD` date or the literal `today`. Omit to show all history.                        |
| `--from <date>`            | Start date (inclusive).                                                                      |
| `--to <date>`              | End date (inclusive).                                                                        |
| `--author <name>`          | Override the git author. Defaults to `git config user.name` (or `defaultAuthor` in config).  |
| `--repo <path...>`         | One or more repo paths to query. Defaults to `defaultRepos` in config, then the current dir. |
| `--format <preset>`        | Ticket format: `jira`, `github`, `conventional`, or `custom`. Defaults to `jira`.            |
| `--ticket-pattern <regex>` | Custom regex for ticket extraction. Implies `--format custom`; overrides `--format`.         |
| `--no-color`               | Disable colored output. Also honored via the `NO_COLOR` env var.                             |

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
