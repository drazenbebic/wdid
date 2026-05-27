import { Command } from 'commander';
import { getCommits, getGitUserName } from './git.js';
import { renderEmpty, renderError, renderTable } from './format.js';
import {
  expandPath,
  getTicketPattern,
  loadConfig,
  type TicketFormat,
} from './config.js';

declare const __VERSION__: string;

interface CliOptions {
  from?: string;
  to?: string;
  author?: string;
  repo?: string[];
  format?: string;
  ticketPattern?: string;
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

  const allEntries = [];
  for (const cwd of repos) {
    const author =
      options.author ?? config.defaultAuthor ?? (await getGitUserName(cwd));
    const entries = await getCommits({ author, from, to, cwd, pattern });
    allEntries.push(...entries);
  }

  allEntries.sort((a, b) => b.date.localeCompare(a.date));

  if (allEntries.length === 0) {
    process.stdout.write(renderEmpty() + '\n');

    return;
  }

  process.stdout.write(renderTable(allEntries) + '\n');
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
  .action(async (dateArg: string | undefined, options: CliOptions) => {
    try {
      await run(dateArg, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
