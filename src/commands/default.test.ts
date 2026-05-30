import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLimit, shouldDisableColor } from './default.js';

describe('parseLimit', () => {
  it('returns undefined when no value is given', () => {
    expect(parseLimit(undefined)).toBeUndefined();
  });

  it('parses positive integers', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('5')).toBe(5);
    expect(parseLimit('999')).toBe(999);
  });

  it('tolerates surrounding whitespace', () => {
    // parseInt skips leading whitespace; trim handles trailing — both flavors
    // canonicalize to the same parsed integer.
    expect(parseLimit('  5  ')).toBe(5);
  });

  it('rejects zero and negatives', () => {
    expect(() => parseLimit('0')).toThrow(/must be a positive integer/);
    expect(() => parseLimit('-1')).toThrow(/must be a positive integer/);
  });

  it('rejects decimals', () => {
    expect(() => parseLimit('1.5')).toThrow(/must be a positive integer/);
  });

  it('rejects non-numeric input', () => {
    expect(() => parseLimit('abc')).toThrow(/must be a positive integer/);
    expect(() => parseLimit('')).toThrow(/must be a positive integer/);
  });

  it('rejects partial-prefix matches (parseInt would silently truncate)', () => {
    // parseInt('5 extra', 10) → 5, but '5' !== '5 extra'.trim() so we reject.
    expect(() => parseLimit('5 extra')).toThrow(/must be a positive integer/);
  });

  it('rejects scientific notation', () => {
    // parseInt('1e3', 10) → 1, but '1' !== '1e3', so we reject.
    expect(() => parseLimit('1e3')).toThrow(/must be a positive integer/);
  });

  it('echoes the offending value in the error message', () => {
    expect(() => parseLimit('abc')).toThrow(/"abc"/);
  });
});

describe('shouldDisableColor', () => {
  let originalNoColor: string | undefined;

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it('returns true when --no-color is passed (options.color === false)', () => {
    expect(shouldDisableColor({ color: false })).toBe(true);
  });

  it('returns false when no flag and no env var are set', () => {
    expect(shouldDisableColor({})).toBe(false);
  });

  it('returns false when NO_COLOR is set to an empty string', () => {
    // no-color.org spec: empty value does NOT disable color.
    process.env.NO_COLOR = '';
    expect(shouldDisableColor({})).toBe(false);
  });

  it('returns true for any non-empty NO_COLOR value', () => {
    process.env.NO_COLOR = '1';
    expect(shouldDisableColor({})).toBe(true);

    process.env.NO_COLOR = 'true';
    expect(shouldDisableColor({})).toBe(true);

    // Note: even "0" / "false" disable color — the spec says any non-empty
    // value, intentionally avoiding truthiness traps across languages.
    process.env.NO_COLOR = '0';
    expect(shouldDisableColor({})).toBe(true);
  });

  it('honors the --no-color flag even when NO_COLOR is empty', () => {
    process.env.NO_COLOR = '';
    expect(shouldDisableColor({ color: false })).toBe(true);
  });
});
