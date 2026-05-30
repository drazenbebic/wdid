---
name: wdid
description: Summarize git commits and calendar meetings, then push them to Toggl as time entries via the `wdid` CLI tool. Use whenever the user asks what they worked on, mentions standup / weekly recap / timesheet, asks to log or sync time to Toggl, asks about meetings or calendar events, references a time period like "today", "yesterday", "last week", or a `YYYY-MM-DD` / `YYYY-MM` date in a work-tracking context, or explicitly mentions wdid. Prefer this skill over raw `git log` for activity-summary tasks — `wdid` parses ticket keys, dedupes by repo and author, emits structured JSON, and integrates Google Calendar meetings alongside git activity.
---

# wdid

Use the `wdid` CLI for git-activity summaries, standup drafts, timesheet recaps, Toggl time-entry pushes, and Google Calendar meeting sync. It pulls from two sources (git commits, Google Calendar events) and pushes to one destination (Toggl).

## Trigger rules

- Activate when the prompt combines "what did I do/work on" (or similar — "what have I been up to", "what was I doing") with a time reference (`today`, `yesterday`, `this week`, `last week`, a month name, an ISO date, or `YYYY-MM`).
- Activate on the phrases: "standup", "weekly recap", "fill in (my) timesheet", "log my time", "sync Toggl", "push (to) Toggl".
- Activate when meetings or calendar come up alongside time-tracking ("push my meetings to Toggl", "log my calendar", "sync gcal").
- For any activity-summary task, prefer `wdid` over `git log --author=...`. `wdid` parses tickets, supports multi-repo, and emits JSON.
- Do **not** activate for git-archeology tasks (debugging history, `git blame`, finding when a bug was introduced) — those are `git log` / `git bisect` territory.

## Core commands

```bash
# Query commits — always prefer --json for parsing
wdid today --json
wdid yesterday --json
wdid 2026-05-27 --json                          # specific day
wdid 2026-05 --json                             # full calendar month
wdid --from 2026-05-01 --to 2026-05-07 --json   # explicit range
wdid --all --json                               # no date filter

# Useful query flags
wdid today --json --author "Jane Doe"
wdid today --json --repo ~/work/api ~/work/web

# Sync everything (meetings then commits) — the usual daily command
wdid sync                              # today
wdid sync yesterday
wdid sync today --dry-run              # preview both sources without pushing
wdid sync today --no-git               # only meetings
wdid sync today --no-gcal              # only commits
wdid sync --from 2026-05-25 --to 2026-05-27

# Git → Toggl sync alone — idempotent (re-runs skip already-synced commits)
wdid git sync                          # today
wdid git sync yesterday
wdid git sync 2026-05-27 --dry-run     # preview before pushing
wdid git sync --from 2026-05-25 --to 2026-05-27

# Google Calendar → Toggl sync alone — idempotent, separate marker namespace
wdid gcal auth                         # one-time browser sign-in (first run only)
wdid gcal status                       # show authorized email + probe refresh token
wdid gcal sync today --dry-run         # preview meetings without pushing
wdid gcal sync today                   # push today's meetings
wdid gcal sync yesterday
wdid gcal sync --from 2026-05-25 --to 2026-05-27
wdid gcal logout                       # clear stored refresh token

# Config (global, ~/.config/wdid/config.json)
wdid config keys                         # discover available keys + types
wdid config list                         # current values (secrets masked)
wdid config get togglWorkspaceId
wdid config set togglWorkspaceId 12345
wdid config path                         # absolute path to the file

# defaultRepos array — use the dedicated subcommands, not `config set`
wdid config repo add ~/work/api
wdid config repo remove ~/work/api
wdid config repo list
```

## Workflow rules

- **Always use `--json`** and parse JSON for the main query command. The table output is for humans; scraping it is fragile.
- **Default to `wdid sync` for "log everything"** asks — daily timesheet, end-of-day push, etc. It runs gcal then git in one shot. Use `wdid git sync` / `wdid gcal sync` only when the user explicitly wants one source, or for debugging.
- **Dry-run before pushing to Toggl** unless the user has already approved the plan. `wdid sync <date> --dry-run`, `wdid git sync <date> --dry-run`, and `wdid gcal sync <date> --dry-run` all print the planned entries with no side effects.
- **Re-runs are safe across both sources.** Toggl entries carry source-tagged markers: `(wdid git:<short-sha>)` for commits, `(wdid gcal:<event-id>)` for meetings. Each source skips its own already-pushed items independently. After a partial failure, re-run the same invocation.
- **`wdid sync` handles missing gcal auth gracefully** — if no refresh token is set, gcal is skipped with a notice and git still runs. So `wdid sync today` is safe even before someone has run `wdid gcal auth`.
- **gcal needs one-time auth** for first use. If `wdid gcal sync` (the standalone) fails with "not authorized," suggest `wdid gcal auth` first.
- **For config questions, run `wdid config keys` first** to see what fields exist and their types instead of guessing field names.
- **Array-shaped fields have dedicated subcommands.** `defaultRepos` is set via `wdid config repo add/remove/list`, not `wdid config set` — `set` only handles scalars and one level of nested record (e.g. `togglProjects.ABC-`).
- **Multi-repo aware.** If `defaultRepos` is set (check via `wdid config repo list`), queries span all of them automatically. Use `--repo <path...>` to override per-invocation.

## Synergy with atlassian-acli

When `wdid --json` surfaces JIRA-style ticket keys (e.g. `EN-4435`), fetch ticket details via the `atlassian-acli` skill (`acli jira workitem view EN-4435 --json`) and use them to _narrate_ the summary instead of dumping commit subjects:

- Plain: `EN-4435: refactor auth middleware; remove dead code`
- Narrated: `EN-4435 ("Auth middleware cleanup", In Progress): refactored the middleware and removed dead code.`

This is the high-value path for standup drafts, weekly recaps, and timesheet annotations. Batch the `acli` calls — one per unique ticket, not one per commit.

## Safety and fallback

- If `wdid` is not on PATH, say the wdid CLI is required and ask the user to `npm install -g @drazenbebic/wdid`, or provide the activity manually.
- If `wdid git sync` or `wdid gcal sync` fails with a Toggl config error, check `wdid config get togglApiToken` and `wdid config get togglWorkspaceId` — both must be set. Prefer the `TOGGL_API_TOKEN` env var over storing the token in the config file when the user is securing secrets out-of-band.
- If `wdid gcal sync` fails with "not authorized", run `wdid gcal auth`. If `wdid gcal status` shows the refresh token is invalid, run `wdid gcal logout` then `wdid gcal auth` to re-consent.
- Before overwriting an existing token, workspace ID, refresh token, or `defaultRepos`, show the current value (`wdid config get <key>`) and confirm with the user.
- If commit results are unexpectedly empty, check the active author (`git config user.name` vs. `defaultAuthor` in config) — multiple author aliases are a common cause. Pass `--author` explicitly to test.
- Do not surface raw `togglApiToken`, `gcalRefreshToken`, or `gcalClientSecret` values in summaries or chat output.
