import chalk from 'chalk';
import type { Command } from 'commander';
import { renderError } from '../format.js';
import { loadConfig } from '../config.js';
import { runGcalSync } from './gcal.js';
import { runGitSync } from './git.js';

export interface SyncCliOptions {
  dryRun?: boolean;
  workspace?: string;
  from?: string;
  to?: string;
  // commander's --no-foo idiom: `foo` is `false` when the flag is passed,
  // `undefined` otherwise. We treat undefined as "yes, run this source."
  git?: boolean;
  gcal?: boolean;
}

export async function runSync(
  dateArg: string | undefined,
  options: SyncCliOptions,
): Promise<void> {
  const includeGit = options.git !== false;
  const includeGcal = options.gcal !== false;

  if (!includeGit && !includeGcal) {
    throw new Error(
      'nothing to sync — both --no-git and --no-gcal were passed',
    );
  }

  const subOptions = {
    dryRun: options.dryRun,
    workspace: options.workspace,
    from: options.from,
    to: options.to,
  };

  // gcal first: meeting times anchor the day at their real start/end. git
  // then follows with its mechanical stack from togglDayStartHour. The
  // ordering doesn't currently prevent overlap (we'd need a meeting-aware
  // git planner for that) but it matches the intuitive "meetings → fill the
  // rest" mental model and sets us up if we ever build that planner.
  if (includeGcal) {
    const config = await loadConfig(process.cwd());

    if (!config.gcalRefreshToken) {
      process.stdout.write(
        chalk.dim(
          'Skipping gcal: not authorized. Run `wdid gcal auth` to enable.',
        ) + '\n',
      );
    } else {
      try {
        await runGcalSync(dateArg, subOptions);
      } catch (err) {
        // Top-level config errors thrown by runGcalSync land here. Per-day
        // failures are already absorbed inside it (stderr + exitCode=1).
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(renderError(`gcal: ${message}`) + '\n');
        process.exitCode = 1;
      }
    }
  }

  if (includeGit && includeGcal) {
    process.stdout.write('\n' + chalk.dim('───') + '\n\n');
  }

  if (includeGit) {
    try {
      await runGitSync(dateArg, subOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(`git: ${message}`) + '\n');
      process.exitCode = 1;
    }
  }
}

export function registerSyncCommand(program: Command): void {
  program
    .command('sync [date]')
    .description(
      'Sync all configured sources (gcal then git) to Toggl in one go.',
    )
    .option('--dry-run', 'preview the plan without pushing')
    .option('--no-git', 'skip the git source')
    .option('--no-gcal', 'skip the gcal source')
    .option(
      '--workspace <id>',
      'override the configured togglWorkspaceId for this run',
    )
    .option(
      '--from <date>',
      'start of a multi-day range (inclusive). Use with --to. Mutually exclusive with [date].',
    )
    .option(
      '--to <date>',
      'end of a multi-day range (inclusive). Use with --from. Mutually exclusive with [date].',
    )
    .addHelpText(
      'after',
      `
Examples:
  $ wdid sync today                      sync today's meetings + commits
  $ wdid sync yesterday --dry-run        preview yesterday without pushing
  $ wdid sync today --no-git             only sync meetings
  $ wdid sync today --no-gcal            only sync commits
  $ wdid sync --from 2026-05-25 --to 2026-05-27   multi-day range`,
    )
    .action(async (dateArg: string | undefined, options: SyncCliOptions) => {
      try {
        await runSync(dateArg, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(renderError(message) + '\n');
        process.exitCode = 1;
      }
    });
}
