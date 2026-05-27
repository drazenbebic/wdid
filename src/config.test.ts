import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_COLUMN_LABELS,
  MAX_CUSTOM_PATTERN_LENGTH,
  expandPath,
  getColumnLabel,
  getTicketPattern,
  PRESET_PATTERNS,
  validateConfig,
} from './config.js';

describe('getTicketPattern', () => {
  it('returns each preset regex', () => {
    expect(getTicketPattern('jira')).toBe(PRESET_PATTERNS.jira);
    expect(getTicketPattern('github')).toBe(PRESET_PATTERNS.github);
    expect(getTicketPattern('conventional')).toBe(PRESET_PATTERNS.conventional);
  });

  it('compiles the custom pattern into a RegExp', () => {
    const re = getTicketPattern('custom', '\\bFOO-\\d+\\b');
    expect(re).toBeInstanceOf(RegExp);
    expect('FOO-42'.match(re)?.[0]).toBe('FOO-42');
  });

  it('throws if format=custom without a customPattern', () => {
    expect(() => getTicketPattern('custom')).toThrow(/customPattern/);
  });

  it('rejects a customPattern longer than the length cap', () => {
    const big = 'a'.repeat(MAX_CUSTOM_PATTERN_LENGTH + 1);
    expect(() => getTicketPattern('custom', big)).toThrow(
      new RegExp(`limit is ${MAX_CUSTOM_PATTERN_LENGTH}`),
    );
  });

  it('rejects an invalid customPattern with a clean error', () => {
    expect(() => getTicketPattern('custom', '[unclosed')).toThrow(
      /not a valid regex/,
    );
  });
});

describe('getColumnLabel', () => {
  it('returns the preset default for each format', () => {
    expect(getColumnLabel('jira')).toBe('Ticket');
    expect(getColumnLabel('github')).toBe('Issue');
    expect(getColumnLabel('conventional')).toBe('Type');
    expect(getColumnLabel('custom')).toBe('Match');
  });

  it('honors an override regardless of format', () => {
    expect(getColumnLabel('jira', 'Tasks')).toBe('Tasks');
    expect(getColumnLabel('custom', 'Ref')).toBe('Ref');
  });

  it('exposes the defaults as a stable map', () => {
    expect(DEFAULT_COLUMN_LABELS.jira).toBe('Ticket');
  });
});

describe('expandPath', () => {
  it('expands a bare ~ to the home dir', () => {
    expect(expandPath('~')).toBe(homedir());
  });

  it('expands ~/ prefixes', () => {
    expect(expandPath('~/work/api')).toBe(join(homedir(), 'work/api'));
  });

  it('leaves absolute paths untouched', () => {
    expect(expandPath('/tmp/foo')).toBe('/tmp/foo');
  });

  it('leaves relative paths untouched', () => {
    expect(expandPath('./foo')).toBe('./foo');
  });
});

describe('validateConfig', () => {
  it('accepts an empty object', () => {
    expect(validateConfig({})).toEqual({});
  });

  it('accepts a valid config', () => {
    const cfg = {
      format: 'github',
      defaultAuthor: 'Jane Doe',
      defaultRepos: ['~/work/api', '~/work/web'],
    };
    expect(validateConfig(cfg)).toEqual(cfg);
  });

  it('rejects non-object input', () => {
    expect(() => validateConfig(null)).toThrow(/object/);
    expect(() => validateConfig('hello')).toThrow(/object/);
  });

  it('rejects unknown format values', () => {
    expect(() => validateConfig({ format: 'mystery' })).toThrow(/invalid/);
  });

  it('rejects custom format without customPattern', () => {
    expect(() => validateConfig({ format: 'custom' })).toThrow(/customPattern/);
  });

  it('accepts custom format with customPattern', () => {
    const cfg = { format: 'custom', customPattern: 'FOO-\\d+' };
    expect(validateConfig(cfg)).toEqual(cfg);
  });

  it('rejects an overlong customPattern at config-load time', () => {
    const cfg = {
      format: 'custom',
      customPattern: 'a'.repeat(MAX_CUSTOM_PATTERN_LENGTH + 1),
    };
    expect(() => validateConfig(cfg)).toThrow(
      new RegExp(`limit is ${MAX_CUSTOM_PATTERN_LENGTH}`),
    );
  });

  it('rejects non-string defaultAuthor', () => {
    expect(() => validateConfig({ defaultAuthor: 42 })).toThrow(/string/);
  });

  it('rejects non-string-array defaultRepos', () => {
    expect(() => validateConfig({ defaultRepos: ['ok', 42] })).toThrow(/array/);
    expect(() => validateConfig({ defaultRepos: 'just-one' })).toThrow(/array/);
  });

  it('accepts a string ticketColumnLabel', () => {
    expect(validateConfig({ ticketColumnLabel: 'Tasks' })).toEqual({
      ticketColumnLabel: 'Tasks',
    });
  });

  it('rejects non-string ticketColumnLabel', () => {
    expect(() => validateConfig({ ticketColumnLabel: 42 })).toThrow(/string/);
  });

  it('accepts a full Toggl config block', () => {
    const cfg = {
      togglApiToken: 'tok',
      togglWorkspaceId: 12345,
      togglProjects: { 'ABC-': 100, 'DEF-': 200 },
      togglDefaultProjectId: 999,
      togglDefaultDurationMinutes: 30,
      togglDayStartHour: 9,
    };
    expect(validateConfig(cfg)).toEqual(cfg);
  });

  it('rejects non-integer togglWorkspaceId', () => {
    expect(() => validateConfig({ togglWorkspaceId: 'oops' })).toThrow(
      /positive integer/,
    );
    expect(() => validateConfig({ togglWorkspaceId: 0 })).toThrow(
      /positive integer/,
    );
  });

  it('rejects togglProjects with non-integer project IDs', () => {
    expect(() => validateConfig({ togglProjects: { 'ABC-': 'oops' } })).toThrow(
      /positive integer/,
    );
  });

  it('rejects togglProjects passed as an array', () => {
    expect(() => validateConfig({ togglProjects: [100, 200] })).toThrow(
      /object/,
    );
  });

  it('rejects togglDayStartHour outside 0–23', () => {
    expect(() => validateConfig({ togglDayStartHour: 24 })).toThrow(/0 and 23/);
    expect(() => validateConfig({ togglDayStartHour: -1 })).toThrow(/0 and 23/);
  });
});
