import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { globalConfigPath, validateConfig, type WdidConfig } from './config.js';
import Table from 'cli-table3';
import chalk from 'chalk';

type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'string-array'
  | 'number-record';

interface FieldSpec {
  type: FieldType;
  values?: readonly string[];
  /** Allows `key.subKey` dotted access. */
  nested?: boolean;
  /** Masked in list/get output unless --show-secrets. */
  secret?: boolean;
  /** False if the field can only be edited by hand (e.g. arrays). */
  settable?: boolean;
  /** Documentation default; informational only, not applied automatically. */
  default?: unknown;
  /** One-line description shown in `wdid config keys`. */
  description?: string;
}

export const FIELDS: Record<string, FieldSpec> = {
  format: {
    type: 'enum',
    values: ['jira', 'github', 'conventional', 'custom'],
    default: 'jira',
    description: 'Ticket extraction preset.',
  },
  customPattern: {
    type: 'string',
    description: 'Regex for ticket extraction when format is "custom".',
  },
  defaultAuthor: {
    type: 'string',
    description:
      'Default author for git log; falls back to git config user.name.',
  },
  defaultRepos: {
    type: 'string-array',
    settable: false,
    description:
      'Repo paths to query when --repo is not given. (~) is expanded.',
  },
  ticketColumnLabel: {
    type: 'string',
    description: 'Override the auto-picked Ticket column header.',
  },
  togglApiToken: {
    type: 'string',
    secret: true,
    description: 'Toggl API token. Prefer the TOGGL_API_TOKEN env var.',
  },
  togglWorkspaceId: {
    type: 'number',
    description: 'Numeric Toggl workspace ID. Required to push.',
  },
  togglProjects: {
    type: 'number-record',
    nested: true,
    description:
      'Map of ticket-prefix → Toggl project ID. Longest prefix wins.',
  },
  togglDefaultProjectId: {
    type: 'number',
    description: 'Project ID for commits without a prefix match.',
  },
  togglDefaultDurationMinutes: {
    type: 'number',
    default: 30,
    description:
      'Per-commit duration. Total = count × this in per-ticket mode.',
  },
  togglDayStartHour: {
    type: 'number',
    default: 9,
    description: 'Hour (0–23) to start stacking entries at.',
  },
  togglOneEntryPerTicket: {
    type: 'boolean',
    default: true,
    description:
      'Collapse same-ticket commits into one entry. No-ticket commits stay 1:1.',
  },
  togglIgnoreSubjectPattern: {
    type: 'string',
    default: '\\bmerge\\b',
    description:
      'Subjects matching this regex (case-insensitive) are skipped. "" to disable.',
  },
};

export interface DottedKey {
  field: keyof typeof FIELDS;
  subKey?: string;
}

export function parseKey(rawKey: string): DottedKey {
  const dotIndex = rawKey.indexOf('.');
  const field = dotIndex === -1 ? rawKey : rawKey.slice(0, dotIndex);
  const subKey = dotIndex === -1 ? undefined : rawKey.slice(dotIndex + 1);
  const spec = FIELDS[field];

  if (!spec) {
    throw new Error(
      `unknown config key "${field}". Known keys: ${Object.keys(FIELDS).join(', ')}`,
    );
  }

  if (subKey !== undefined && !spec.nested) {
    throw new Error(
      `config key "${field}" does not support dotted access (it is a ${spec.type})`,
    );
  }

  if (subKey === '') {
    throw new Error(`empty sub-key in "${rawKey}"`);
  }

  return { field, subKey };
}

export function parseValue(field: string, rawValue: string): unknown {
  const spec = FIELDS[field];

  if (!spec) {
    throw new Error(`unknown config key "${field}"`);
  }

  if (spec.settable === false) {
    throw new Error(
      `"${field}" cannot be set from the CLI — edit the config file directly`,
    );
  }

  switch (spec.type) {
    case 'string':
      return rawValue;

    case 'enum':
      if (!spec.values?.includes(rawValue)) {
        throw new Error(
          `"${rawValue}" is not a valid value for "${field}" — must be one of ${spec.values?.join(', ')}`,
        );
      }

      return rawValue;

    case 'number':
    case 'number-record': {
      const n = Number(rawValue);

      if (!Number.isFinite(n)) {
        throw new Error(`"${rawValue}" is not a valid number for "${field}"`);
      }

      return n;
    }

    case 'boolean':
      if (rawValue === 'true') {
        return true;
      }

      if (rawValue === 'false') {
        return false;
      }

      throw new Error(
        `"${rawValue}" is not a valid boolean for "${field}" — use "true" or "false"`,
      );

    case 'string-array':
      throw new Error(`"${field}" is an array — edit the config file directly`);

    default:
      throw new Error(`internal: unhandled field type for "${field}"`);
  }
}

export function setConfigValue(
  cfg: WdidConfig,
  rawKey: string,
  rawValue: string,
): WdidConfig {
  const { field, subKey } = parseKey(rawKey);
  const next: WdidConfig = { ...cfg };

  if (subKey !== undefined) {
    // Nested: only number-record is supported (togglProjects)
    const spec = FIELDS[field]!;

    if (spec.type !== 'number-record') {
      throw new Error(
        `internal: nested set requested for non-record field "${field}"`,
      );
    }

    const parsed = parseValue(field, rawValue) as number;
    const current = (cfg[field as keyof WdidConfig] ?? {}) as Record<
      string,
      number
    >;
    (next[field as keyof WdidConfig] as unknown) = {
      ...current,
      [subKey]: parsed,
    };
  } else {
    (next[field as keyof WdidConfig] as unknown) = parseValue(field, rawValue);
  }

  // Final validation pass — the merged config must still pass schema checks.
  return validateConfig(next as unknown);
}

export function getConfigValue(cfg: WdidConfig, rawKey: string): unknown {
  const { field, subKey } = parseKey(rawKey);
  const value = cfg[field as keyof WdidConfig];

  if (subKey === undefined) {
    return value;
  }

  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[subKey];
}

export function maskSecret(value: string): string {
  if (value.length <= 10) {
    return '***';
  }

  return `${value.slice(0, 4)}…${value.slice(-6)}`;
}

function formatValue(value: unknown, secret: boolean, reveal: boolean): string {
  if (value === undefined) {
    return '(not set)';
  }

  if (secret && !reveal && typeof value === 'string') {
    return maskSecret(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export function renderConfigList(
  cfg: WdidConfig,
  options: { showSecrets?: boolean } = {},
): string {
  const reveal = options.showSecrets ?? false;
  const keys = Object.keys(cfg) as Array<keyof WdidConfig>;
  const presentKeys = keys.filter(k => cfg[k] !== undefined);

  if (presentKeys.length === 0) {
    return chalk.gray('(no values set)');
  }

  const table = new Table({
    head: [chalk.bold.cyan('Key'), chalk.bold.cyan('Value')],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [32, 60],
  });

  for (const k of presentKeys) {
    const spec = FIELDS[k];
    const secret = spec?.secret ?? false;
    const formatted = formatValue(cfg[k], secret, reveal);
    const valueCell = secret && !reveal ? chalk.dim(formatted) : formatted;
    table.push([chalk.cyan(k), valueCell]);
  }

  return table.toString();
}

function formatFieldType(spec: FieldSpec): string {
  switch (spec.type) {
    case 'enum':
      return `enum (${(spec.values ?? []).join(' | ')})`;
    case 'string-array':
      return 'string[]';
    case 'number-record':
      return 'Record<string, number>';
    default:
      return spec.type;
  }
}

function formatFieldNotes(spec: FieldSpec): string {
  const tags: string[] = [];

  if (spec.secret) {
    tags.push('secret');
  }

  if (spec.nested) {
    tags.push('nested');
  }

  if (spec.settable === false) {
    tags.push('edit file directly');
  }

  return tags.length > 0 ? tags.join(', ') : '';
}

function formatFieldDefault(spec: FieldSpec): string {
  if (spec.default === undefined) {
    return '';
  }

  return typeof spec.default === 'string'
    ? spec.default
    : JSON.stringify(spec.default);
}

export function renderConfigKeys(): string {
  const table = new Table({
    head: [
      chalk.bold.cyan('Key'),
      chalk.bold.cyan('Type'),
      chalk.bold.cyan('Default'),
      chalk.bold.cyan('Notes'),
      chalk.bold.cyan('Description'),
    ],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [30, 26, 16, 22, 48],
  });

  for (const [key, spec] of Object.entries(FIELDS)) {
    table.push([
      chalk.cyan(key),
      formatFieldType(spec),
      chalk.dim(formatFieldDefault(spec)),
      chalk.yellow(formatFieldNotes(spec)),
      chalk.dim(spec.description ?? ''),
    ]);
  }

  return table.toString();
}

export function renderSingleValue(
  value: unknown,
  field: string,
  reveal: boolean,
): string {
  const spec = FIELDS[field];

  return formatValue(value, spec?.secret ?? false, reveal);
}

export function normalizeRepoPath(
  rawPath: string,
  cwd: string,
  home: string,
): string {
  if (rawPath === '~' || rawPath.startsWith('~/')) {
    return rawPath;
  }

  // Resolve relative paths against cwd; absolute paths pass through.
  const abs = resolve(cwd, rawPath);

  // Re-tildify paths under HOME so shell-expanded inputs (`~/foo` → /Users/me/foo)
  // canonicalize back to the tilde form and dedup correctly against literal-tilde
  // entries already in the config.
  if (abs === home) {
    return '~';
  }

  if (abs.startsWith(home + '/')) {
    return '~/' + abs.slice(home.length + 1);
  }

  return abs;
}

export function addRepo(
  cfg: WdidConfig,
  rawPath: string,
  cwd: string,
  home: string,
): WdidConfig {
  const normalized = normalizeRepoPath(rawPath, cwd, home);
  const existing = cfg.defaultRepos ?? [];

  if (existing.includes(normalized)) {
    throw new Error(`"${normalized}" is already in defaultRepos`);
  }

  return validateConfig({
    ...cfg,
    defaultRepos: [...existing, normalized],
  }) as WdidConfig;
}

export function removeRepo(
  cfg: WdidConfig,
  rawPath: string,
  cwd: string,
  home: string,
): WdidConfig {
  const normalized = normalizeRepoPath(rawPath, cwd, home);
  const existing = cfg.defaultRepos ?? [];

  if (!existing.includes(normalized)) {
    throw new Error(`"${normalized}" is not in defaultRepos`);
  }

  const filtered = existing.filter(p => p !== normalized);
  const next: WdidConfig = { ...cfg };

  if (filtered.length === 0) {
    delete next.defaultRepos;
  } else {
    next.defaultRepos = filtered;
  }

  return validateConfig(next) as WdidConfig;
}

export async function readGlobalConfig(): Promise<WdidConfig> {
  try {
    const content = await readFile(globalConfigPath(), 'utf-8');

    return validateConfig(JSON.parse(content));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw err;
  }
}

export async function writeGlobalConfig(cfg: WdidConfig): Promise<void> {
  const path = globalConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}
