import chalk from 'chalk';
import { Command } from 'commander';
import { getCommits, getGitUserName } from './git.js';
import {
  renderEmpty,
  renderError,
  renderJson,
  renderTable,
  renderTableGroupedByDay,
} from './format.js';
import {
  expandPath,
  getColumnLabel,
  getTicketPattern,
  loadConfig,
  TOGGL_DEFAULTS,
  type TicketFormat,
  type WdidConfig,
} from './config.js';
import {
  fetchSyncedShas,
  planEntries,
  pushEntries,
  type TogglAuth,
  type TogglEntryPlan,
} from './integrations/toggl.js';

declare const __VERSION__: string;

interface CliOptions {
  from?: string;
  to?: string;
  author?: string;
  repo?: string[];
  format?: string;
  ticketPattern?: string;
  color?: boolean;
  limit?: string;
  groupByDay?: boolean;
  json?: boolean;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const n = Number.parseInt(raw, 10);

  if (!Number.isInteger(n) || n < 1 || String(n) !== raw.trim()) {
    throw new Error(`invalid --limit "${raw}" — must be a positive integer`);
  }

  return n;
}

function shouldDisableColor(options: CliOptions): boolean {
  if (options.color === false) {
    return true;
  }

  // https://no-color.org/ — any non-empty value disables color.
  const noColor = process.env.NO_COLOR ?? '';

  return noColor.length > 0;
}

const VALID_PRESETS: readonly TicketFormat[] = [
  'jira',
  'github',
  'conventional',
  'custom',
];

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolveDate(input: string): string {
  if (input === 'today') {
    return new Date().toISOString().slice(0, 10);
  }

  if (!isIsoDate(input)) {
    throw new Error(`invalid date "${input}" — expected YYYY-MM-DD or "today"`);
  }

  return input;
}

async function run(
  dateArg: string | undefined,
  options: CliOptions,
): Promise<void> {
  const config = await loadConfig(process.cwd());

  let format: TicketFormat;
  let customPattern: string | undefined;

  if (options.ticketPattern) {
    format = 'custom';
    customPattern = options.ticketPattern;
  } else if (options.format) {
    if (!VALID_PRESETS.includes(options.format as TicketFormat)) {
      throw new Error(
        `invalid --format "${options.format}" — must be one of ${VALID_PRESETS.join(', ')}`,
      );
    }

    format = options.format as TicketFormat;
    customPattern = config.customPattern;
  } else {
    format = config.format ?? 'jira';
    customPattern = config.customPattern;
  }

  const pattern = getTicketPattern(format, customPattern);

  const configRepos = config.defaultRepos?.map(expandPath) ?? [];
  const repos =
    options.repo && options.repo.length > 0
      ? options.repo
      : configRepos.length > 0
        ? configRepos
        : [process.cwd()];

  let from = options.from ? resolveDate(options.from) : undefined;
  let to = options.to ? resolveDate(options.to) : undefined;

  if (dateArg) {
    const day = resolveDate(dateArg);
    from = day;
    to = day;
  }

  const limit = parseLimit(options.limit);

  const perRepoEntries = await Promise.all(
    repos.map(async cwd => {
      const author =
        options.author ?? config.defaultAuthor ?? (await getGitUserName(cwd));

      return getCommits({ author, from, to, cwd, pattern, limit });
    }),
  );
  const allEntries = perRepoEntries.flat();

  allEntries.sort((a, b) =>
    `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`),
  );

  const display = limit !== undefined ? allEntries.slice(0, limit) : allEntries;
  const ticketColumnLabel = getColumnLabel(format, config.ticketColumnLabel);

  if (options.json) {
    process.stdout.write(renderJson(display, ticketColumnLabel) + '\n');

    return;
  }

  if (display.length === 0) {
    process.stdout.write(renderEmpty() + '\n');

    return;
  }

  const rendered = options.groupByDay
    ? renderTableGroupedByDay(display, ticketColumnLabel)
    : renderTable(display, ticketColumnLabel);
  process.stdout.write(rendered + '\n');
}

interface TogglSyncCliOptions {
  dryRun?: boolean;
  workspace?: string;
  repo?: string[];
  author?: string;
}

function resolveTogglAuth(config: WdidConfig): TogglAuth | null {
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

function renderTogglPlan(
  plan: TogglEntryPlan[],
  date: string,
  durationSeconds: number,
): string {
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
      new Date(entry.start).getTime() + durationSeconds * 1000,
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

    lines.push(
      `  ${status}  ${chalk.dim(`${start}–${end}`)}  ${entry.description}  ${project}`,
    );
  }

  return lines.join('\n');
}

async function runTogglSync(
  dateArg: string | undefined,
  options: TogglSyncCliOptions,
): Promise<void> {
  const config = await loadConfig(process.cwd());

  const date = resolveDate(dateArg ?? 'today');
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

  const perRepoCommits = await Promise.all(
    repos.map(async cwd => {
      const author =
        options.author ?? config.defaultAuthor ?? (await getGitUserName(cwd));

      return getCommits({ author, from: date, to: date, cwd, pattern });
    }),
  );
  const commits = perRepoCommits.flat();

  const existingSyncedShas = auth
    ? await fetchSyncedShas(auth, date)
    : new Set<string>();

  const defaultDurationMinutes =
    config.togglDefaultDurationMinutes ?? TOGGL_DEFAULTS.durationMinutes;
  const dayStartHour = config.togglDayStartHour ?? TOGGL_DEFAULTS.dayStartHour;

  const plan = planEntries(commits, {
    date,
    defaultDurationMinutes,
    dayStartHour,
    projects: config.togglProjects ?? {},
    defaultProjectId: config.togglDefaultProjectId,
    existingSyncedShas,
  });

  if (plan.length === 0) {
    process.stdout.write(chalk.gray(`No commits to sync for ${date}.`) + '\n');

    return;
  }

  process.stdout.write(
    renderTogglPlan(plan, date, defaultDurationMinutes * 60) + '\n',
  );

  if (options.dryRun) {
    process.stdout.write('\n' + chalk.dim('(dry-run — nothing pushed)') + '\n');

    return;
  }

  if (!auth || workspaceId === null) {
    // Should be unreachable given checks above, but TS doesn't know that.
    throw new Error('internal: auth/workspaceId resolved to null');
  }

  const result = await pushEntries(auth, workspaceId, plan);

  process.stdout.write(
    '\n' +
      chalk.bold(`Pushed ${result.pushed}, skipped ${result.skipped}`) +
      (result.failures.length > 0
        ? chalk.red(`, ${result.failures.length} failed`)
        : '') +
      '\n',
  );

  for (const failure of result.failures) {
    process.stderr.write(
      chalk.red(`  failed: ${failure.plan.shortSha} — ${failure.reason}`) +
        '\n',
    );
  }

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

const program = new Command();

program
  .name('wdid')
  .description('What did I do? — summarize your git commits as a table')
  .version(__VERSION__, '-V, --version', 'output the version number')
  .argument('[date]', 'a YYYY-MM-DD date or "today"; omit to show all history')
  .option('--from <date>', 'start date (YYYY-MM-DD or "today")')
  .option('--to <date>', 'end date (YYYY-MM-DD or "today")')
  .option(
    '--author <name>',
    'override the git author (defaults to git config user.name, then defaultAuthor in config)',
  )
  .option(
    '--repo <path...>',
    'one or more repo paths to query (overrides defaultRepos in config; defaults to current directory)',
  )
  .option(
    '--format <preset>',
    'ticket format: jira | github | conventional | custom (default: jira, or config.format)',
  )
  .option(
    '--ticket-pattern <regex>',
    'custom regex for ticket extraction (implies --format custom; overrides --format)',
  )
  .option(
    '--no-color',
    'disable colored output (also honored via the NO_COLOR env var)',
  )
  .option(
    '--limit <N>',
    'cap the table to the most recent N rows (positive integer)',
  )
  .option(
    '--group-by-day',
    'group rows under a bold date heading per day (time-only in row)',
  )
  .option('--json', 'emit a JSON array of commit entries instead of the table')
  .action(async (dateArg: string | undefined, options: CliOptions) => {
    if (shouldDisableColor(options)) {
      chalk.level = 0;
    }

    try {
      await run(dateArg, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

const togglCmd = program
  .command('toggl')
  .description('Toggl integration commands');

togglCmd
  .command('sync [date]')
  .description(
    "push the day's commits as Toggl time entries (one per commit). Default: today.",
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
  .action(async (dateArg: string | undefined, options: TogglSyncCliOptions) => {
    try {
      await runTogglSync(dateArg, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
