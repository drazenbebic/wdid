import { Command } from 'commander';
import { banner } from './utils/banner.js';
import { registerDefaultCommand } from './commands/default.js';
import { registerGitCommand } from './commands/git.js';
import { registerGcalCommand } from './commands/gcal.js';
import { registerConfigCommand } from './commands/config.js';

declare const __VERSION__: string;

const program = new Command();
program.enablePositionalOptions();

program
  .name('wdid')
  .description('What did I do? — summarize your git commits as a table')
  .version(__VERSION__, '-V, --version', 'output the version number')
  .addHelpText('before', banner);

registerDefaultCommand(program);
registerGitCommand(program);
registerGcalCommand(program);
registerConfigCommand(program);

program.addHelpText(
  'after',
  `
Examples:
  $ wdid today                              commits from today
  $ wdid yesterday                          commits from yesterday
  $ wdid 2026-05-27                         commits from a specific day
  $ wdid 2026-05                            commits from a whole month
  $ wdid --from 2026-05-01 --to 2026-05-07  a date range
  $ wdid --all                              all history, no filter
  $ wdid git sync today                     push today's commits to Toggl
  $ wdid gcal sync today                    push today's meetings to Toggl
  $ wdid config list                        show global config`,
);

if (process.argv.length <= 2) {
  program.help();
}

void program.parseAsync(process.argv);
