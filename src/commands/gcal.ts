import chalk from 'chalk';
import type { Command } from 'commander';
import { renderError } from '../format.js';
import { GCAL_DEFAULTS, loadConfig, type WdidConfig } from '../config.js';
import { readGlobalConfig, writeGlobalConfig } from '../config-cli.js';
import {
  enumerateDates,
  fetchSyncedMarkers,
  pushEntries,
  type TogglAuth,
  type TogglEntryPlan,
} from '../destinations/toggl.js';
import { fetchGcalEvents, planGcalEntries } from '../sources/gcal.js';
import {
  getGoogleCredentials,
  refreshAccessToken,
  runInstalledAppOAuth,
} from '../oauth/google.js';
import { resolveDate } from '../utils/date.js';

interface GcalSyncCliOptions {
  dryRun?: boolean;
  workspace?: string;
  from?: string;
  to?: string;
}

function resolveSyncDates(
  dateArg: string | undefined,
  options: { from?: string; to?: string },
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

  return token ? { apiToken: token } : null;
}

async function runGcalAuth(): Promise<void> {
  const config = await readGlobalConfig();
  const creds = getGoogleCredentials(config);

  if (!creds) {
    throw new Error(
      'no Google OAuth client configured. Either install a wdid build that ' +
        'bundles credentials, or set gcalClientId and gcalClientSecret in your ' +
        'config (BYO your own OAuth client).',
    );
  }

  process.stdout.write(chalk.dim('Opening browser for Google sign-in…') + '\n');

  const result = await runInstalledAppOAuth(creds);

  await writeGlobalConfig({
    ...config,
    gcalRefreshToken: result.refreshToken,
    gcalAuthorizedEmail: result.email,
  });

  process.stdout.write(
    chalk.green(`Authorized as ${result.email}.`) +
      chalk.dim(' Refresh token saved.') +
      '\n',
  );
}

async function runGcalStatus(): Promise<void> {
  const config = await readGlobalConfig();

  if (!config.gcalRefreshToken) {
    process.stdout.write(
      chalk.gray('Not authorized. Run `wdid gcal auth` to sign in.') + '\n',
    );
    process.exitCode = 1;

    return;
  }

  process.stdout.write(
    chalk.green(`Authorized as ${config.gcalAuthorizedEmail ?? '(unknown)'}.`) +
      '\n',
  );

  const creds = getGoogleCredentials(config);

  if (!creds) {
    process.stdout.write(
      chalk.yellow('No OAuth client configured — refresh would fail.') + '\n',
    );

    return;
  }

  // Probe the refresh token to confirm it still works.
  try {
    await refreshAccessToken(creds, config.gcalRefreshToken);
    process.stdout.write(chalk.dim('Refresh token is valid.') + '\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(chalk.red(`Refresh failed: ${message}`) + '\n');
    process.exitCode = 1;
  }
}

async function runGcalLogout(): Promise<void> {
  const config = await readGlobalConfig();

  if (!config.gcalRefreshToken && !config.gcalAuthorizedEmail) {
    process.stdout.write(chalk.gray('Already signed out.') + '\n');

    return;
  }

  const { gcalRefreshToken: _t, gcalAuthorizedEmail: _e, ...rest } = config;
  await writeGlobalConfig(rest);

  process.stdout.write(
    chalk.green('Signed out. Refresh token cleared.') + '\n',
  );
}

function renderGcalPlan(plan: TogglEntryPlan[], date: string): string {
  const newCount = plan.filter(p => !p.alreadySynced).length;
  const skipCount = plan.length - newCount;
  const lines: string[] = [];

  lines.push(
    chalk.bold(`GCal sync — ${date}`) +
      chalk.dim(
        `  (${newCount} new, ${skipCount} already synced, ${plan.length} total)`,
      ),
  );
  lines.push('');

  for (const entry of plan) {
    const start = new Date(entry.start);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startHM = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const end = new Date(start.getTime() + entry.durationSeconds * 1000);
    const endHM = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
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
      `  ${status}  ${chalk.dim(`${startHM}–${endHM}`)}  ${entry.description}  ${project}`,
    );
  }

  return lines.join('\n');
}

async function runGcalSync(
  dateArg: string | undefined,
  options: GcalSyncCliOptions,
): Promise<void> {
  const config = await loadConfig(process.cwd());

  const creds = getGoogleCredentials(config);

  if (!creds) {
    throw new Error(
      'no Google OAuth client configured. Run `wdid gcal auth` first, or set gcalClientId/gcalClientSecret.',
    );
  }

  if (!config.gcalRefreshToken) {
    throw new Error('not authorized. Run `wdid gcal auth` first.');
  }

  const dates = resolveSyncDates(dateArg, options);

  const workspaceId =
    (options.workspace
      ? Number.parseInt(options.workspace, 10)
      : config.togglWorkspaceId) ?? null;

  if (!options.dryRun && workspaceId === null) {
    throw new Error(
      'togglWorkspaceId is not set — add it to your config or pass --workspace <id>',
    );
  }

  const togglAuth = resolveTogglAuth(config);

  if (!options.dryRun && !togglAuth) {
    throw new Error(
      'no Toggl API token — set TOGGL_API_TOKEN or `togglApiToken` in your config',
    );
  }

  const accessToken = await refreshAccessToken(creds, config.gcalRefreshToken);

  const ignoreSource =
    config.gcalIgnoreTitlePattern ?? GCAL_DEFAULTS.ignoreTitlePattern;
  const ignoreTitlePattern = ignoreSource
    ? new RegExp(ignoreSource, 'i')
    : undefined;

  const filters = {
    skipDeclined: config.gcalSkipDeclined ?? GCAL_DEFAULTS.skipDeclined,
    skipAllDay: config.gcalSkipAllDay ?? GCAL_DEFAULTS.skipAllDay,
    ignoreTitlePattern,
  };

  let anyFailed = false;

  for (const date of dates) {
    try {
      const events = await fetchGcalEvents(accessToken, date);
      const existingSyncedMarkers = togglAuth
        ? await fetchSyncedMarkers(togglAuth, date)
        : new Set<string>();

      const plan = planGcalEntries(events, {
        filters,
        projects: config.gcalProjects ?? {},
        defaultProjectId: config.gcalDefaultProjectId,
        existingSyncedMarkers,
      });

      if (plan.length === 0) {
        process.stdout.write(
          chalk.gray(`No events to sync for ${date}.`) + '\n',
        );

        continue;
      }

      process.stdout.write(renderGcalPlan(plan, date) + '\n');

      if (options.dryRun) {
        continue;
      }

      if (!togglAuth || workspaceId === null) {
        throw new Error(
          'internal: togglAuth/workspaceId null with dryRun=false',
        );
      }

      const pushResult = await pushEntries(togglAuth, workspaceId, plan);
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
        anyFailed = true;
        process.stderr.write(
          chalk.red(
            `  ${date} failed: ${failure.plan.shortShas.join(',')} — ${failure.reason}`,
          ) + '\n',
        );
      }
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(chalk.red(`  ${date}: ${message}`) + '\n');
    }
  }

  if (options.dryRun) {
    process.stdout.write('\n' + chalk.dim('(dry-run — nothing pushed)') + '\n');
  }

  if (anyFailed) {
    process.exitCode = 1;
  }
}

function wrapAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(renderError(message) + '\n');
      process.exitCode = 1;
    }
  };
}

export function registerGcalCommand(program: Command): void {
  const gcalCmd = program
    .command('gcal')
    .description('Sync Google Calendar events to Toggl as time entries')
    .action(() => {
      gcalCmd.help();
    });

  gcalCmd.addHelpText(
    'after',
    `
Examples:
  $ wdid gcal auth                          one-time browser sign-in
  $ wdid gcal status                        show authorized email + token state
  $ wdid gcal sync today --dry-run          preview today's meetings
  $ wdid gcal sync today                    push today's meetings to Toggl
  $ wdid gcal sync --from 2026-05-25 --to 2026-05-27  push a multi-day range
  $ wdid gcal logout                        clear the stored refresh token`,
  );

  gcalCmd
    .command('auth')
    .description('Open browser for Google sign-in and persist a refresh token.')
    .action(wrapAction(runGcalAuth));

  gcalCmd
    .command('status')
    .description('Show authorized email and probe the refresh token.')
    .action(wrapAction(runGcalStatus));

  gcalCmd
    .command('logout')
    .description('Clear the stored refresh token + authorized email.')
    .action(wrapAction(runGcalLogout));

  gcalCmd
    .command('sync [date]')
    .description(
      "push the day's calendar events as Toggl time entries. Default: today.",
    )
    .option('--dry-run', 'preview the plan without pushing')
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
    .action(
      wrapAction(
        async (dateArg: string | undefined, options: GcalSyncCliOptions) => {
          await runGcalSync(dateArg, options);
        },
      ),
    );
}
