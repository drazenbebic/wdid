# wdid

> What did I do? — a small CLI that summarizes your git activity as a tidy table, so you can fill in your timesheet without trying to remember Tuesday.

`wdid` reads `git log` for your author across one or more repos and renders the output as a colorized table with **Date**, **Ticket** (JIRA-style `ABC-123`, parsed from the commit subject), and **Description**.

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
┌────────────┬──────────────┬──────────────────────────────────────────────────┐
│ Date       │ Ticket       │ Description                                      │
├────────────┼──────────────┼──────────────────────────────────────────────────┤
│ 2026-05-27 │ ABC-123      │ feat(ABC-123): add login flow                    │
│ 2026-05-27 │ —            │ chore: bump deps                                 │
│ 2026-05-26 │ ABC-119      │ fix(ABC-119): handle empty payload               │
└────────────┴──────────────┴──────────────────────────────────────────────────┘
```

If a commit doesn't reference a ticket, the Ticket column is left blank (rendered as `—`).

## Options

| Option             | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `[date]`           | A `YYYY-MM-DD` date or the literal `today`. Omit to show all history. |
| `--from <date>`    | Start date (inclusive).                                               |
| `--to <date>`      | End date (inclusive).                                                 |
| `--author <name>`  | Override the git author. Defaults to `git config user.name`.          |
| `--repo <path...>` | One or more repo paths to query. Defaults to the current directory.   |

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
