import { describe, expect, it } from 'vitest';
import { extractTicket } from './git.js';

describe('extractTicket', () => {
  it('extracts a JIRA-style ticket from a conventional-commit subject', () => {
    expect(extractTicket('feat(ABC-123): add login flow')).toBe('ABC-123');
  });

  it('extracts a ticket from a bracketed prefix', () => {
    expect(extractTicket('[ABC-123] fix bug')).toBe('ABC-123');
  });

  it('extracts a ticket from a free-form message', () => {
    expect(extractTicket('Fixes ABC-456 and improves logging')).toBe('ABC-456');
  });

  it('returns the first ticket when multiple are present', () => {
    expect(extractTicket('Refs ABC-1 and DEF-2')).toBe('ABC-1');
  });

  it('supports project keys with digits', () => {
    expect(extractTicket('chore(PROJ2-99): tidy')).toBe('PROJ2-99');
  });

  it('returns null when no ticket is present', () => {
    expect(extractTicket('chore: bump deps')).toBeNull();
  });

  it('does not match lowercase project keys', () => {
    expect(extractTicket('abc-123 lowercase should not match')).toBeNull();
  });

  it('does not match incomplete patterns', () => {
    expect(extractTicket('ABC- missing number')).toBeNull();
    expect(extractTicket('-123 missing prefix')).toBeNull();
  });
});
