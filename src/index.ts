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
  enumerateDates,
  fetchSyncedShas,
  planEntries,
  pushEntries,
  type TogglAuth,
  type TogglEntryPlan,
} from './integrations/toggl.js';
import {
  FIELDS,
  parseKey,
  readGlobalConfig,
  renderConfigKeys,
  renderConfigList,
  renderSingleValue,
  setConfigValue,
  getConfigValue,
  writeGlobalConfig,
} from './config-cli.js';
import { globalConfigPath } from './config.js';

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

function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function resolveYearMonth(value: string): { from: string; to: string } {
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

function resolveDate(input: string): string {
  if (input === 'today') {
    return new Date().toISOString().slice(0, 10);
  }

  if (input === 'yesterday') {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);

    return d.toISOString().slice(0, 10);
  }

  if (!isIsoDate(input)) {
    throw new Error(
      `invalid date "${input}" — expected YYYY-MM-DD, "today", or "yesterday"`,
    );
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
    if (isYearMonth(dateArg)) {
      const range = resolveYearMonth(dateArg);
      from = range.from;
      to = range.to;
    } else {
      const day = resolveDate(dateArg);
      from = day;
      to = day;
    }
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
  from?: string;
  to?: string;
}

function resolveTogglSyncDates(
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

async function syncOneDay(date: string, ctx: DayContext): Promise<DayResult> {
  const result: DayResult = {
    date,
    planned: 0,
    pushed: 0,
    skipped: 0,
    failures: 0,
  };

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

    const existingSyncedShas = ctx.auth
      ? await fetchSyncedShas(ctx.auth, date)
      : new Set<string>();

    const plan = planEntries(commits, {
      date,
      defaultDurationMinutes: ctx.defaultDurationMinutes,
      dayStartHour: ctx.dayStartHour,
      projects: ctx.projects,
      defaultProjectId: ctx.defaultProjectId,
      existingSyncedShas,
      oneEntryPerTicket: ctx.oneEntryPerTicket,
      ignoreSubjectPattern: ctx.ignoreSubjectPattern,
    });

    result.planned = plan.length;

    if (plan.length === 0) {
      process.stdout.write(
        chalk.gray(`No commits to sync for ${date}.`) + '\n',
      );

      return result;
    }

    process.stdout.write(renderTogglPlan(plan, date) + '\n');

    if (ctx.dryRun) {
      return result;
    }

    if (!ctx.auth || ctx.workspaceId === null) {
      throw new Error('internal: auth/workspaceId resolved to null');
    }

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

async function runTogglSync(
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

const program = new Command();
program.enablePositionalOptions();

program
  .name('wdid')
  .description('What did I do? — summarize your git commits as a table')
  .version(__VERSION__, '-V, --version', 'output the version number')
  .argument(
    '[date]',
    'a YYYY-MM-DD date, YYYY-MM month, "today", or "yesterday"; omit to show all history',
  )
  .option('--from <date>', 'start date (YYYY-MM-DD, "today", or "yesterday")')
  .option('--to <date>', 'end date (YYYY-MM-DD, "today", or "yesterday")')
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
  .action(async (dateArg: string | undefined, options: TogglSyncCliOptions) => {
    try {
      await runTogglSync(dateArg, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

interface ConfigGetOptions {
  showSecrets?: boolean;
}

interface ConfigListOptions {
  showSecrets?: boolean;
}

async function runConfigSet(key: string, value: string): Promise<void> {
  const current = await readGlobalConfig();
  const next = setConfigValue(current, key, value);
  await writeGlobalConfig(next);

  const { field } = parseKey(key);
  const isSecret = FIELDS[field]?.secret ?? false;
  process.stdout.write(
    chalk.green(`set ${key}`) +
      (isSecret ? chalk.dim(' (secret — value hidden)') : '') +
      '\n',
  );
}

async function runConfigGet(
  key: string,
  options: ConfigGetOptions,
): Promise<void> {
  const cfg = await readGlobalConfig();
  const value = getConfigValue(cfg, key);
  const { field } = parseKey(key);

  process.stdout.write(
    renderSingleValue(value, field, options.showSecrets ?? false) + '\n',
  );

  if (value === undefined) {
    process.exitCode = 1;
  }
}

async function runConfigList(options: ConfigListOptions): Promise<void> {
  const cfg = await readGlobalConfig();
  process.stdout.write(
    renderConfigList(cfg, { showSecrets: options.showSecrets }) + '\n',
  );
}

function runConfigPath(): void {
  process.stdout.write(globalConfigPath() + '\n');
}

const configCmd = program
  .command('config')
  .description('Read and write the global wdid config file');

configCmd
  .command('set <key> <value>')
  .description(
    'Set a value in the global config (~/.config/wdid/config.json). Use dotted access for nested fields (togglProjects.ABC-).',
  )
  .action(async (key: string, value: string) => {
    try {
      await runConfigSet(key, value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

configCmd
  .command('get <key>')
  .description(
    'Print a single config value. Secrets are masked unless --show-secrets is set.',
  )
  .option('--show-secrets', 'reveal secret values in full')
  .action(async (key: string, options: ConfigGetOptions) => {
    try {
      await runConfigGet(key, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

configCmd
  .command('list')
  .description(
    'Print all configured values. Secrets are masked unless --show-secrets is set.',
  )
  .option('--show-secrets', 'reveal secret values in full')
  .action(async (options: ConfigListOptions) => {
    try {
      await runConfigList(options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

configCmd
  .command('path')
  .description(
    'Print the absolute path to the global config file (honors XDG_CONFIG_HOME).',
  )
  .action(() => {
    runConfigPath();
  });

configCmd
  .command('keys')
  .description('List every config key with its type, default, and description.')
  .action(() => {
    process.stdout.write(renderConfigKeys() + '\n');
  });

program.parseAsync(process.argv);
