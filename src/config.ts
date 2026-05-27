import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cosmiconfig } from 'cosmiconfig';

export type TicketFormat = 'jira' | 'github' | 'conventional' | 'custom';

export interface WdidConfig {
  format?: TicketFormat;
  customPattern?: string;
  defaultAuthor?: string;
  defaultRepos?: string[];
  ticketColumnLabel?: string;
}

export const DEFAULT_COLUMN_LABELS: Record<TicketFormat, string> = {
  jira: 'Ticket',
  github: 'Issue',
  conventional: 'Type',
  custom: 'Match',
};

export function getColumnLabel(
  format: TicketFormat,
  override?: string,
): string {
  return override ?? DEFAULT_COLUMN_LABELS[format];
}

export const PRESET_PATTERNS: Record<
  Exclude<TicketFormat, 'custom'>,
  RegExp
> = {
  jira: /\b([A-Z][A-Z0-9]+-\d+)\b/,
  github: /#(\d+)/,
  conventional: /^(\w+(?:\([^)]+\))?!?):/,
};

const VALID_FORMATS: readonly TicketFormat[] = [
  'jira',
  'github',
  'conventional',
  'custom',
];

export function getTicketPattern(
  format: TicketFormat,
  customPattern?: string,
): RegExp {
  if (format === 'custom') {
    if (!customPattern) {
      throw new Error('format "custom" requires customPattern to be set');
    }

    return new RegExp(customPattern);
  }

  return PRESET_PATTERNS[format];
}

export function expandPath(p: string): string {
  if (p === '~') {
    return homedir();
  }

  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }

  return p;
}

export function validateConfig(raw: unknown): WdidConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('config must be an object');
  }

  const obj = raw as Record<string, unknown>;
  const cfg: WdidConfig = {};

  if ('format' in obj) {
    if (
      typeof obj.format !== 'string' ||
      !VALID_FORMATS.includes(obj.format as TicketFormat)
    ) {
      throw new Error(
        `invalid format "${String(obj.format)}" — must be one of ${VALID_FORMATS.join(', ')}`,
      );
    }

    cfg.format = obj.format as TicketFormat;
  }

  if ('customPattern' in obj) {
    if (typeof obj.customPattern !== 'string') {
      throw new Error('customPattern must be a string');
    }

    cfg.customPattern = obj.customPattern;
  }

  if (cfg.format === 'custom' && !cfg.customPattern) {
    throw new Error('format "custom" requires customPattern to be set');
  }

  if ('defaultAuthor' in obj) {
    if (typeof obj.defaultAuthor !== 'string') {
      throw new Error('defaultAuthor must be a string');
    }

    cfg.defaultAuthor = obj.defaultAuthor;
  }

  if ('defaultRepos' in obj) {
    if (
      !Array.isArray(obj.defaultRepos) ||
      !obj.defaultRepos.every(r => typeof r === 'string')
    ) {
      throw new Error('defaultRepos must be an array of strings');
    }

    cfg.defaultRepos = obj.defaultRepos as string[];
  }

  if ('ticketColumnLabel' in obj) {
    if (typeof obj.ticketColumnLabel !== 'string') {
      throw new Error('ticketColumnLabel must be a string');
    }

    cfg.ticketColumnLabel = obj.ticketColumnLabel;
  }

  return cfg;
}

function globalConfigPath(): string {
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');

  return join(xdgConfigHome, 'wdid', 'config.json');
}

async function loadGlobalConfig(): Promise<WdidConfig | null> {
  try {
    const content = await readFile(globalConfigPath(), 'utf-8');

    return validateConfig(JSON.parse(content));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw err;
  }
}

export async function loadConfig(cwd: string): Promise<WdidConfig> {
  const explorer = cosmiconfig('wdid');
  const local = await explorer.search(cwd);

  if (local?.config) {
    return validateConfig(local.config);
  }

  const global = await loadGlobalConfig();

  if (global) {
    return global;
  }

  return {};
}
