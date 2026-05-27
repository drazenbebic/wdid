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
  togglApiToken?: string;
  togglWorkspaceId?: number;
  togglProjects?: Record<string, number>;
  togglDefaultProjectId?: number;
  togglDefaultDurationMinutes?: number;
  togglDayStartHour?: number;
  togglOneEntryPerTicket?: boolean;
  togglIgnoreSubjectPattern?: string;
}

export const TOGGL_DEFAULTS = {
  durationMinutes: 30,
  dayStartHour: 9,
  oneEntryPerTicket: true,
  ignoreSubjectPattern: '\\bmerge\\b',
} as const;

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

export const MAX_CUSTOM_PATTERN_LENGTH = 500;

function compileUserRegex(pattern: string): RegExp {
  if (pattern.length > MAX_CUSTOM_PATTERN_LENGTH) {
    throw new Error(
      `customPattern is ${pattern.length} characters; limit is ${MAX_CUSTOM_PATTERN_LENGTH}`,
    );
  }

  try {
    // `customPattern` is intentionally user-supplied — accepting an
    // arbitrary regex is the entire purpose of format=custom. We can't
    // escape it (that would defeat the feature). Mitigation is the
    // length cap above plus the fact that wdid only runs locally
    // against repos the user has chosen to query.
    // lgtm[js/regex-injection]
    return new RegExp(pattern);
  } catch (err) {
    throw new Error(
      `customPattern is not a valid regex: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

export function getTicketPattern(
  format: TicketFormat,
  customPattern?: string,
): RegExp {
  if (format === 'custom') {
    if (!customPattern) {
      throw new Error('format "custom" requires customPattern to be set');
    }

    return compileUserRegex(customPattern);
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

    if (obj.customPattern.length > MAX_CUSTOM_PATTERN_LENGTH) {
      throw new Error(
        `customPattern is ${obj.customPattern.length} characters; limit is ${MAX_CUSTOM_PATTERN_LENGTH}`,
      );
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

  if ('togglApiToken' in obj) {
    if (typeof obj.togglApiToken !== 'string') {
      throw new Error('togglApiToken must be a string');
    }

    cfg.togglApiToken = obj.togglApiToken;
  }

  if ('togglWorkspaceId' in obj) {
    if (
      typeof obj.togglWorkspaceId !== 'number' ||
      !Number.isInteger(obj.togglWorkspaceId) ||
      obj.togglWorkspaceId < 1
    ) {
      throw new Error('togglWorkspaceId must be a positive integer');
    }

    cfg.togglWorkspaceId = obj.togglWorkspaceId;
  }

  if ('togglProjects' in obj) {
    const raw = obj.togglProjects;

    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(
        'togglProjects must be an object mapping ticket prefix → project ID',
      );
    }

    const map: Record<string, number> = {};
    for (const [prefix, projectId] of Object.entries(raw)) {
      if (
        typeof projectId !== 'number' ||
        !Number.isInteger(projectId) ||
        projectId < 1
      ) {
        throw new Error(
          `togglProjects["${prefix}"] must be a positive integer`,
        );
      }

      map[prefix] = projectId;
    }
    cfg.togglProjects = map;
  }

  if ('togglDefaultProjectId' in obj) {
    if (
      typeof obj.togglDefaultProjectId !== 'number' ||
      !Number.isInteger(obj.togglDefaultProjectId) ||
      obj.togglDefaultProjectId < 1
    ) {
      throw new Error('togglDefaultProjectId must be a positive integer');
    }

    cfg.togglDefaultProjectId = obj.togglDefaultProjectId;
  }

  if ('togglDefaultDurationMinutes' in obj) {
    if (
      typeof obj.togglDefaultDurationMinutes !== 'number' ||
      !Number.isInteger(obj.togglDefaultDurationMinutes) ||
      obj.togglDefaultDurationMinutes < 1
    ) {
      throw new Error('togglDefaultDurationMinutes must be a positive integer');
    }

    cfg.togglDefaultDurationMinutes = obj.togglDefaultDurationMinutes;
  }

  if ('togglDayStartHour' in obj) {
    if (
      typeof obj.togglDayStartHour !== 'number' ||
      !Number.isInteger(obj.togglDayStartHour) ||
      obj.togglDayStartHour < 0 ||
      obj.togglDayStartHour > 23
    ) {
      throw new Error('togglDayStartHour must be an integer between 0 and 23');
    }

    cfg.togglDayStartHour = obj.togglDayStartHour;
  }

  if ('togglOneEntryPerTicket' in obj) {
    if (typeof obj.togglOneEntryPerTicket !== 'boolean') {
      throw new Error('togglOneEntryPerTicket must be a boolean');
    }

    cfg.togglOneEntryPerTicket = obj.togglOneEntryPerTicket;
  }

  if ('togglIgnoreSubjectPattern' in obj) {
    if (typeof obj.togglIgnoreSubjectPattern !== 'string') {
      throw new Error('togglIgnoreSubjectPattern must be a string');
    }

    if (obj.togglIgnoreSubjectPattern.length > MAX_CUSTOM_PATTERN_LENGTH) {
      throw new Error(
        `togglIgnoreSubjectPattern is ${obj.togglIgnoreSubjectPattern.length} characters; limit is ${MAX_CUSTOM_PATTERN_LENGTH}`,
      );
    }

    cfg.togglIgnoreSubjectPattern = obj.togglIgnoreSubjectPattern;
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
