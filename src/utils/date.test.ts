import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isIsoDate,
  isYearMonth,
  resolveDate,
  resolveYearMonth,
} from './date.js';

describe('isIsoDate', () => {
  it('accepts valid YYYY-MM-DD strings', () => {
    expect(isIsoDate('2026-05-27')).toBe(true);
    expect(isIsoDate('1970-01-01')).toBe(true);
  });

  it('rejects missing zero-padding', () => {
    expect(isIsoDate('2026-5-27')).toBe(false);
    expect(isIsoDate('2026-05-7')).toBe(false);
  });

  it('rejects wrong separators', () => {
    expect(isIsoDate('2026/05/27')).toBe(false);
    expect(isIsoDate('2026.05.27')).toBe(false);
  });

  it('rejects 2-digit years', () => {
    expect(isIsoDate('26-05-27')).toBe(false);
  });

  it('rejects empty and keyword strings', () => {
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('today')).toBe(false);
    expect(isIsoDate('yesterday')).toBe(false);
  });
});

describe('isYearMonth', () => {
  it('accepts every valid month', () => {
    for (let m = 1; m <= 12; m += 1) {
      const mm = String(m).padStart(2, '0');
      expect(isYearMonth(`2026-${mm}`)).toBe(true);
    }
  });

  it('rejects month 00 and 13+', () => {
    expect(isYearMonth('2026-00')).toBe(false);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('2026-99')).toBe(false);
  });

  it('rejects unpadded months', () => {
    expect(isYearMonth('2026-5')).toBe(false);
  });

  it('rejects full ISO dates', () => {
    expect(isYearMonth('2026-05-27')).toBe(false);
  });

  it('rejects empty and arbitrary strings', () => {
    expect(isYearMonth('')).toBe(false);
    expect(isYearMonth('today')).toBe(false);
  });
});

describe('resolveYearMonth', () => {
  it('returns first and last day of a 31-day month', () => {
    expect(resolveYearMonth('2026-05')).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
    });
  });

  it('returns first and last day of a 30-day month', () => {
    expect(resolveYearMonth('2026-04')).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
    });
  });

  it('handles non-leap February (28 days)', () => {
    expect(resolveYearMonth('2023-02')).toEqual({
      from: '2023-02-01',
      to: '2023-02-28',
    });
  });

  it('handles leap February (29 days)', () => {
    expect(resolveYearMonth('2024-02')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });

  it('handles year-end (December)', () => {
    expect(resolveYearMonth('2026-12')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('handles year-start (January)', () => {
    expect(resolveYearMonth('2026-01')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('respects century leap rules: 2000 is a leap year', () => {
    expect(resolveYearMonth('2000-02')).toEqual({
      from: '2000-02-01',
      to: '2000-02-29',
    });
  });

  it('respects century leap rules: 1900 is not a leap year', () => {
    expect(resolveYearMonth('1900-02')).toEqual({
      from: '1900-02-01',
      to: '1900-02-28',
    });
  });
});

describe('resolveDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through a valid ISO date verbatim', () => {
    expect(resolveDate('2026-05-27')).toBe('2026-05-27');
  });

  it('resolves "today" to the current UTC date', () => {
    vi.setSystemTime(new Date('2026-05-30T12:34:56Z'));
    expect(resolveDate('today')).toBe('2026-05-30');
  });

  it('resolves "yesterday" to UTC today minus one day', () => {
    vi.setSystemTime(new Date('2026-05-30T12:34:56Z'));
    expect(resolveDate('yesterday')).toBe('2026-05-29');
  });

  it('handles "yesterday" across a month boundary', () => {
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
    expect(resolveDate('yesterday')).toBe('2026-04-30');
  });

  it('handles "yesterday" across a year boundary', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(resolveDate('yesterday')).toBe('2025-12-31');
  });

  it('handles "yesterday" after Feb 29 in a leap year', () => {
    vi.setSystemTime(new Date('2024-03-01T00:00:00Z'));
    expect(resolveDate('yesterday')).toBe('2024-02-29');
  });

  it('throws on bogus input with a helpful message', () => {
    expect(() => resolveDate('bogus')).toThrow(/expected YYYY-MM-DD/);
    expect(() => resolveDate('')).toThrow(/expected YYYY-MM-DD/);
    expect(() => resolveDate('2026-5-27')).toThrow(/expected YYYY-MM-DD/);
  });
});
