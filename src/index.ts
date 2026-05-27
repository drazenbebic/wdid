import { Command } from 'commander';
import { getCommits, getGitUserName } from './git.js';
import { renderEmpty, renderError, renderTable } from './format.js';

interface CliOptions {
  from?: string;
  to?: string;
  author?: string;
  repo?: string[];
}

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
  const repos =
    options.repo && options.repo.length > 0 ? options.repo : [process.cwd()];

  let from = options.from ? resolveDate(options.from) : undefined;
  let to = options.to ? resolveDate(options.to) : undefined;

  if (dateArg) {
    const day = resolveDate(dateArg);
    from = day;
    to = day;
  }

  const allEntries = [];
  for (const cwd of repos) {
    const author = options.author ?? (await getGitUserName(cwd));
    const entries = await getCommits({ author, from, to, cwd });
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
  .argument('[date]', 'a YYYY-MM-DD date or "today"; omit to show all history')
  .option('--from <date>', 'start date (YYYY-MM-DD or "today")')
  .option('--to <date>', 'end date (YYYY-MM-DD or "today")')
  .option(
    '--author <name>',
    'override the git author (defaults to git config user.name)',
  )
  .option(
    '--repo <path...>',
    'one or more repo paths to query (defaults to current directory)',
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
