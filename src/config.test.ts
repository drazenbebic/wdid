import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_COLUMN_LABELS,
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
});
