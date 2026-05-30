import chalk from 'chalk';
import type { Command } from 'commander';
import { getCommits, getGitUserName } from '../sources/git.js';
import { renderError } from '../format.js';
import {
  expandPath,
  getTicketPattern,
  loadConfig,
  TOGGL_DEFAULTS,
  type TicketFormat,
  type WdidConfig,
} from '../config.js';
import {
  enumerateDates,
  fetchSyncedMarkers,
  planEntries,
  pushEntries,
  type TogglAuth,
  type TogglEntryPlan,
} from '../destinations/toggl.js';
import { resolveDate } from '../utils/date.js';

export interface TogglSyncCliOptions {
  dryRun?: boolean;
  workspace?: string;
  repo?: string[];
  author?: string;
  from?: string;
  to?: string;
}

interface DayResult {
  date: string;
  planned: number;
  pushed: number;
  skipped: number;
  failures: number;
  error?: string;
}

interface DayContext {
  auth: TogglAuth | null;
  workspaceId: number | null;
  dryRun: boolean;
  repos: string[];
  cliAuthor?: string;
  configAuthor?: string;
  pattern: RegExp;
  defaultDurationMinutes: number;
  dayStartHour: number;
  oneEntryPerTicket: boolean;
  ignoreSubjectPattern?: RegExp;
  projects: Record<string, number>;
  defaultProjectId?: number;
}

export function resolveTogglSyncDates(
  dateArg: string | undefined,
  options: TogglSyncCliOptions,
): string[] {
  if (dateArg && (options.from || options.to)) {
    throw new Error(
      'cannot combine the positional [date] with --from / --to — use one or the other',
    );
  }

  if (options.from || options.to) {
    if (!options.from || !options.to) {
      throw new Error('--from and --to must both be provided');
    }

    return enumerateDates(resolveDate(options.from), resolveDate(options.to));
  }

  return [resolveDate(dateArg ?? 'today')];
}

export function resolveTogglAuth(config: WdidConfig): TogglAuth | null {
  const token = process.env.TOGGL_API_TOKEN ?? config.togglApiToken;

  if (!token) {
    return null;
  }

  return { apiToken: token };
}

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderTogglPlan(plan: TogglEntryPlan[], date: string): string {
  const newCount = plan.filter(p => !p.alreadySynced).length;
  const skipCount = plan.length - newCount;
  const lines: string[] = [];

  lines.push(
    chalk.bold(`Toggl sync — ${date}`) +
      chalk.dim(
        `  (${newCount} new, ${skipCount} already synced, ${plan.length} total)`,
      ),
  );
  lines.push('');

  for (const entry of plan) {
    const start = formatHHMM(entry.start);
    const endIso = new Date(
      new Date(entry.start).getTime() + entry.durationSeconds * 1000,
    ).toISOString();
    const end = formatHHMM(endIso);
    const status = entry.alreadySynced
      ? chalk.gray('skip')
      : chalk.green('new ');
    const project =
      entry.projectId === null
        ? chalk.yellow('(no project)')
        : chalk.cyan(
            `[project ${entry.projectId}${entry.matchedTicketPrefix ? ` ← ${entry.matchedTicketPrefix}` : ' (default)'}]`,
          );
    const commitNote =
      entry.commitCount > 1 ? chalk.dim(` (${entry.commitCount} commits)`) : '';

    lines.push(
      `  ${status}  ${chalk.dim(`${start}–${end}`)}  ${entry.description}  ${project}${commitNote}`,
    );
  }

  return lines.join('\n');
}

async function syncOneDay(date: string, ctx: DayContext): Promise<DayResult> {
  const result: DayResult = {
    date,
    planned: 0,
    pushed: 0,
    skipped: 0,
    failures: 0,
  };

  let plan: TogglEntryPlan[];

  try {
    const perRepoCommits = await Promise.all(
      ctx.repos.map(async cwd => {
        const author =
          ctx.cliAuthor ?? ctx.configAuthor ?? (await getGitUserName(cwd));

        return getCommits({
          author,
          from: date,
          to: date,
          cwd,
          pattern: ctx.pattern,
        });
      }),
    );
    const commits = perRepoCommits.flat();

    const existingSyncedMarkers = ctx.auth
      ? await fetchSyncedMarkers(ctx.auth, date)
      : new Set<string>();

    plan = planEntries(commits, {
      date,
      defaultDurationMinutes: ctx.defaultDurationMinutes,
      dayStartHour: ctx.dayStartHour,
      projects: ctx.projects,
      defaultProjectId: ctx.defaultProjectId,
      existingSyncedMarkers,
      oneEntryPerTicket: ctx.oneEntryPerTicket,
      ignoreSubjectPattern: ctx.ignoreSubjectPattern,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    process.stderr.write(chalk.red(`  ${date}: ${message}`) + '\n');

    return result;
  }

  result.planned = plan.length;

  if (plan.length === 0) {
    process.stdout.write(chalk.gray(`No commits to sync for ${date}.`) + '\n');

    return result;
  }

  process.stdout.write(renderTogglPlan(plan, date) + '\n');

  if (ctx.dryRun) {
    return result;
  }

  // runGitSync's caller already rejects when dryRun=false and auth/workspaceId
  // are missing, so this only narrows types — a real fire is a logic bug and
  // should propagate, not be folded into the per-day failure path.
  if (!ctx.auth || ctx.workspaceId === null) {
    throw new Error(
      'internal: auth/workspaceId resolved to null with dryRun=false',
    );
  }

  try {
    const pushResult = await pushEntries(ctx.auth, ctx.workspaceId, plan);
    result.pushed = pushResult.pushed;
    result.skipped = pushResult.skipped;
    result.failures = pushResult.failures.length;

    process.stdout.write(
      '\n' +
        chalk.bold(
          `  ${date}: pushed ${pushResult.pushed}, skipped ${pushResult.skipped}`,
        ) +
        (pushResult.failures.length > 0
          ? chalk.red(`, ${pushResult.failures.length} failed`)
          : '') +
        '\n',
    );

    for (const failure of pushResult.failures) {
      process.stderr.write(
        chalk.red(
          `  ${date} failed: ${failure.plan.shortShas.join(',')} — ${failure.reason}`,
        ) + '\n',
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = message;
    process.stderr.write(chalk.red(`  ${date}: ${message}`) + '\n');
  }

  return result;
}

export async function runGitSync(
  dateArg: string | undefined,
  options: TogglSyncCliOptions,
): Promise<void> {
  const config = await loadConfig(process.cwd());

  const dates = resolveTogglSyncDates(dateArg, options);

  const workspaceId =
    (options.workspace
      ? Number.parseInt(options.workspace, 10)
      : config.togglWorkspaceId) ?? null;

  if (!options.dryRun && workspaceId === null) {
    throw new Error(
      'togglWorkspaceId is not set — add it to your config or pass --workspace <id>',
    );
  }

  const auth = resolveTogglAuth(config);

  if (!options.dryRun && !auth) {
    throw new Error(
      'no Toggl API token — set TOGGL_API_TOKEN or `togglApiToken` in your config',
    );
  }

  const format: TicketFormat = config.format ?? 'jira';
  const pattern = getTicketPattern(format, config.customPattern);

  const configRepos = config.defaultRepos?.map(expandPath) ?? [];
  const repos =
    options.repo && options.repo.length > 0
      ? options.repo
      : configRepos.length > 0
        ? configRepos
        : [process.cwd()];

  const defaultDurationMinutes =
    config.togglDefaultDurationMinutes ?? TOGGL_DEFAULTS.durationMinutes;
  const dayStartHour = config.togglDayStartHour ?? TOGGL_DEFAULTS.dayStartHour;
  const oneEntryPerTicket =
    config.togglOneEntryPerTicket ?? TOGGL_DEFAULTS.oneEntryPerTicket;
  const ignoreSubjectSource =
    config.togglIgnoreSubjectPattern ?? TOGGL_DEFAULTS.ignoreSubjectPattern;
  const ignoreSubjectPattern = ignoreSubjectSource
    ? new RegExp(ignoreSubjectSource, 'i')
    : undefined;

  const ctx: DayContext = {
    auth,
    workspaceId,
    dryRun: options.dryRun ?? false,
    repos,
    cliAuthor: options.author,
    configAuthor: config.defaultAuthor,
    pattern,
    defaultDurationMinutes,
    dayStartHour,
    oneEntryPerTicket,
    ignoreSubjectPattern,
    projects: config.togglProjects ?? {},
    defaultProjectId: config.togglDefaultProjectId,
  };

  const results: DayResult[] = [];
  for (const date of dates) {
    results.push(await syncOneDay(date, ctx));
  }

  if (options.dryRun) {
    process.stdout.write('\n' + chalk.dim('(dry-run — nothing pushed)') + '\n');

    return;
  }

  if (dates.length > 1) {
    const totalPushed = results.reduce((n, r) => n + r.pushed, 0);
    const totalSkipped = results.reduce((n, r) => n + r.skipped, 0);
    const totalFailures = results.reduce((n, r) => n + r.failures, 0);
    const erroredDays = results.filter(r => r.error !== undefined).length;

    process.stdout.write(
      '\n' +
        chalk.bold(
          `Total across ${dates.length} days: pushed ${totalPushed}, skipped ${totalSkipped}`,
        ) +
        (totalFailures > 0 ? chalk.red(`, ${totalFailures} failed`) : '') +
        (erroredDays > 0 ? chalk.red(`, ${erroredDays} day(s) errored`) : '') +
        '\n',
    );
  }

  const anyFailed = results.some(r => r.error !== undefined || r.failures > 0);

  if (anyFailed) {
    process.exitCode = 1;
  }
}

export function registerGitCommand(program: Command): void {
  const gitCmd = program
    .command('git')
    .description('Sync git commits to Toggl as time entries')
    .action(() => {
      gitCmd.help();
    });

  gitCmd.addHelpText(
    'after',
    `
Examples:
  $ wdid git sync                                  push today's commits
  $ wdid git sync yesterday                        push yesterday's commits
  $ wdid git sync 2026-05-27                       push a specific day
  $ wdid git sync today --dry-run                  preview without pushing
  $ wdid git sync --workspace 12345 today          override the workspace
  $ wdid git sync --from 2026-05-25 --to 2026-05-27  push a multi-day range`,
  );

  gitCmd
    .command('sync [date]')
    .description(
      "push the day's commits as Toggl time entries. Default: today. Pass --from/--to for a range.",
    )
    .option('--dry-run', 'preview the plan without pushing')
    .option(
      '--workspace <id>',
      'override the configured togglWorkspaceId for this run',
    )
    .option(
      '--repo <path...>',
      'one or more repo paths to query (overrides defaultRepos in config)',
    )
    .option(
      '--author <name>',
      'override the git author (defaults to git config user.name, then defaultAuthor in config)',
    )
    .option(
      '--from <date>',
      'start of a multi-day range (inclusive). Use with --to. Mutually exclusive with [date].',
    )
    .option(
      '--to <date>',
      'end of a multi-day range (inclusive). Use with --from. Mutually exclusive with [date].',
    )
    .action(
      async (dateArg: string | undefined, options: TogglSyncCliOptions) => {
        try {
          await runGitSync(dateArg, options);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(renderError(message) + '\n');
          process.exitCode = 1;
        }
      },
    );
}
