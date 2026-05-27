import { describe, expect, it } from 'vitest';
import { extractTicket, formatLocalDateTime } from './git.js';
import { getTicketPattern } from './config.js';

const jiraPattern = getTicketPattern('jira');
const githubPattern = getTicketPattern('github');
const conventionalPattern = getTicketPattern('conventional');

describe('extractTicket — jira preset', () => {
  it('extracts a JIRA-style ticket from a conventional-commit subject', () => {
    expect(extractTicket('feat(ABC-123): add login flow', jiraPattern)).toBe(
      'ABC-123',
    );
  });

  it('extracts a ticket from a bracketed prefix', () => {
    expect(extractTicket('[ABC-123] fix bug', jiraPattern)).toBe('ABC-123');
  });

  it('extracts a ticket from a free-form message', () => {
    expect(
      extractTicket('Fixes ABC-456 and improves logging', jiraPattern),
    ).toBe('ABC-456');
  });

  it('returns the first ticket when multiple are present', () => {
    expect(extractTicket('Refs ABC-1 and DEF-2', jiraPattern)).toBe('ABC-1');
  });

  it('supports project keys with digits', () => {
    expect(extractTicket('chore(PROJ2-99): tidy', jiraPattern)).toBe(
      'PROJ2-99',
    );
  });

  it('returns null when no ticket is present', () => {
    expect(extractTicket('chore: bump deps', jiraPattern)).toBeNull();
  });

  it('does not match lowercase project keys', () => {
    expect(
      extractTicket('abc-123 lowercase should not match', jiraPattern),
    ).toBeNull();
  });

  it('does not match incomplete patterns', () => {
    expect(extractTicket('ABC- missing number', jiraPattern)).toBeNull();
    expect(extractTicket('-123 missing prefix', jiraPattern)).toBeNull();
  });
});

describe('extractTicket — github preset', () => {
  it('extracts a #-prefixed issue number', () => {
    expect(extractTicket('Closes #42 for the dashboard', githubPattern)).toBe(
      '42',
    );
  });

  it('returns the first match', () => {
    expect(extractTicket('refs #10 and #20', githubPattern)).toBe('10');
  });

  it('returns null without a hash', () => {
    expect(extractTicket('fix login bug', githubPattern)).toBeNull();
  });
});

describe('extractTicket — conventional preset', () => {
  it('extracts the type from a plain conventional commit', () => {
    expect(extractTicket('feat: add login', conventionalPattern)).toBe('feat');
  });

  it('extracts type with scope', () => {
    expect(
      extractTicket('feat(auth): add login flow', conventionalPattern),
    ).toBe('feat(auth)');
  });

  it('extracts breaking-change marker', () => {
    expect(
      extractTicket('feat(auth)!: change response shape', conventionalPattern),
    ).toBe('feat(auth)!');
  });

  it('returns null when subject is not conventional', () => {
    expect(
      extractTicket('just a random commit', conventionalPattern),
    ).toBeNull();
  });
});

describe('formatLocalDateTime', () => {
  it('returns empty strings for invalid input', () => {
    expect(formatLocalDateTime('')).toEqual({ date: '', time: '' });
    expect(formatLocalDateTime('not a date')).toEqual({ date: '', time: '' });
  });

  it('formats an ISO timestamp in the viewer local timezone', () => {
    const iso = '2026-05-27T14:30:42+02:00';
    const expectedDate = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expected = {
      date: `${expectedDate.getFullYear()}-${pad(expectedDate.getMonth() + 1)}-${pad(expectedDate.getDate())}`,
      time: `${pad(expectedDate.getHours())}:${pad(expectedDate.getMinutes())}`,
    };
    expect(formatLocalDateTime(iso)).toEqual(expected);
  });

  it('zero-pads single-digit months, days, hours and minutes', () => {
    const { date, time } = formatLocalDateTime('2026-01-03T05:07:00Z');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(time).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('extractTicket — custom regex', () => {
  it('uses the first capture group when present', () => {
    const pattern = getTicketPattern('custom', '\\[([A-Z]+-\\d+)\\]');
    expect(extractTicket('[FOO-7] do stuff', pattern)).toBe('FOO-7');
  });

  it('falls back to the full match when no capture group', () => {
    const pattern = getTicketPattern('custom', '[A-Z]+-\\d+');
    expect(extractTicket('see FOO-7 for details', pattern)).toBe('FOO-7');
  });
});
