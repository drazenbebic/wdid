import chalk from 'chalk';
import type { Command } from 'commander';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { renderError } from '../format.js';
import { expandPath, globalConfigPath } from '../config.js';
import {
  addRepo,
  FIELDS,
  getConfigValue,
  normalizeRepoPath,
  parseKey,
  readGlobalConfig,
  removeRepo,
  renderConfigKeys,
  renderConfigList,
  renderSingleValue,
  setConfigValue,
  writeGlobalConfig,
} from '../config-cli.js';

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

async function assertRepoExists(rawPath: string): Promise<void> {
  const stored = normalizeRepoPath(rawPath, process.cwd(), homedir());
  // expandPath turns "~/foo" into "/home/.../foo" for the stat call only;
  // we keep the tilde form in storage so the config stays portable.
  const onDisk = expandPath(stored);

  const stats = await stat(onDisk).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      throw new Error(`"${stored}" does not exist on disk`, { cause: err });
    }

    throw err;
  });

  if (!stats.isDirectory()) {
    throw new Error(`"${stored}" exists but is not a directory`);
  }
}

async function runConfigRepoAdd(rawPath: string): Promise<void> {
  await assertRepoExists(rawPath);
  const current = await readGlobalConfig();
  const next = addRepo(current, rawPath, process.cwd(), homedir());
  await writeGlobalConfig(next);
  const stored = normalizeRepoPath(rawPath, process.cwd(), homedir());
  process.stdout.write(chalk.green(`added ${stored} to defaultRepos`) + '\n');
}

async function runConfigRepoRemove(rawPath: string): Promise<void> {
  const current = await readGlobalConfig();
  const next = removeRepo(current, rawPath, process.cwd(), homedir());
  await writeGlobalConfig(next);
  const stored = normalizeRepoPath(rawPath, process.cwd(), homedir());
  process.stdout.write(
    chalk.green(`removed ${stored} from defaultRepos`) + '\n',
  );
}

async function runConfigRepoList(): Promise<void> {
  const cfg = await readGlobalConfig();
  const repos = cfg.defaultRepos ?? [];

  if (repos.length === 0) {
    process.stdout.write(chalk.gray('(no default repos configured)') + '\n');
    process.exitCode = 1;

    return;
  }

  for (const repo of repos) {
    process.stdout.write(`  ${repo}\n`);
  }
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Read and write the global wdid config file')
    .action(() => {
      configCmd.help();
    });

  configCmd.addHelpText(
    'after',
    `
Examples:
  $ wdid config keys                              list every available key
  $ wdid config set togglApiToken tok_abc123      set a scalar field
  $ wdid config set togglWorkspaceId 12345        numbers are parsed
  $ wdid config set togglOneEntryPerTicket false  booleans take true/false
  $ wdid config set togglProjects.ABC- 67890      set a nested record entry
  $ wdid config get togglApiToken                 secrets are masked
  $ wdid config get togglApiToken --show-secrets  reveal the secret
  $ wdid config list                              show all set fields
  $ wdid config path                              print the config file path
  $ wdid config repo add ~/work/api               add a repo to defaultRepos
  $ wdid config repo remove ~/work/api            remove a repo from defaultRepos
  $ wdid config repo list                         show configured repos`,
  );

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
    .description(
      'List every config key with its type, default, and description.',
    )
    .action(() => {
      process.stdout.write(renderConfigKeys() + '\n');
    });

  const configRepoCmd = configCmd
    .command('repo')
    .description('Manage the defaultRepos array (add / remove / list)')
    .action(() => {
      configRepoCmd.help();
    });

  configRepoCmd
    .command('add <path>')
    .description(
      'Add a repo path to defaultRepos. Tilde paths are preserved; relative paths are resolved.',
    )
    .action(async (path: string) => {
      try {
        await runConfigRepoAdd(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(renderError(message) + '\n');
        process.exitCode = 1;
      }
    });

  configRepoCmd
    .command('remove <path>')
    .description('Remove a repo path from defaultRepos.')
    .action(async (path: string) => {
      try {
        await runConfigRepoRemove(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(renderError(message) + '\n');
        process.exitCode = 1;
      }
    });

  configRepoCmd
    .command('list')
    .description('List the configured repo paths.')
    .action(async () => {
      try {
        await runConfigRepoList();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(renderError(message) + '\n');
        process.exitCode = 1;
      }
    });
}
