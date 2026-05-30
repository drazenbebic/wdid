import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTogglAuth, resolveTogglSyncDates } from './toggl.js';

describe('resolveTogglSyncDates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to today when nothing is provided', () => {
    expect(resolveTogglSyncDates(undefined, {})).toEqual(['2026-05-30']);
  });

  it('returns a single-element array for a positional date', () => {
    expect(resolveTogglSyncDates('2026-05-27', {})).toEqual(['2026-05-27']);
  });

  it('resolves the "yesterday" keyword via the positional', () => {
    expect(resolveTogglSyncDates('yesterday', {})).toEqual(['2026-05-29']);
  });

  it('expands an inclusive range when --from and --to are both given', () => {
    const result = resolveTogglSyncDates(undefined, {
      from: '2026-05-27',
      to: '2026-05-30',
    });
    expect(result).toEqual([
      '2026-05-27',
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
    ]);
  });

  it('throws when [date] is combined with --from', () => {
    expect(() =>
      resolveTogglSyncDates('2026-05-27', { from: '2026-05-25' }),
    ).toThrow(/cannot combine the positional/);
  });

  it('throws when [date] is combined with --to', () => {
    expect(() =>
      resolveTogglSyncDates('2026-05-27', { to: '2026-05-30' }),
    ).toThrow(/cannot combine the positional/);
  });

  it('throws when only --from is given', () => {
    expect(() =>
      resolveTogglSyncDates(undefined, { from: '2026-05-27' }),
    ).toThrow(/--from and --to must both be provided/);
  });

  it('throws when only --to is given', () => {
    expect(() =>
      resolveTogglSyncDates(undefined, { to: '2026-05-30' }),
    ).toThrow(/--from and --to must both be provided/);
  });

  it('propagates invalid-date errors from resolveDate', () => {
    expect(() => resolveTogglSyncDates('bogus', {})).toThrow(
      /expected YYYY-MM-DD/,
    );
  });
});

describe('resolveTogglAuth', () => {
  let originalToken: string | undefined;

  beforeEach(() => {
    originalToken = process.env.TOGGL_API_TOKEN;
    delete process.env.TOGGL_API_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TOGGL_API_TOKEN;
    } else {
      process.env.TOGGL_API_TOKEN = originalToken;
    }
  });

  it('returns null when neither env nor config has a token', () => {
    expect(resolveTogglAuth({})).toBeNull();
  });

  it('uses the config token when no env var is set', () => {
    expect(resolveTogglAuth({ togglApiToken: 'cfg-token' })).toEqual({
      apiToken: 'cfg-token',
    });
  });

  it('uses the env var when no config token is set', () => {
    process.env.TOGGL_API_TOKEN = 'env-token';
    expect(resolveTogglAuth({})).toEqual({ apiToken: 'env-token' });
  });

  it('prefers the env var when both are set', () => {
    process.env.TOGGL_API_TOKEN = 'env-token';
    expect(resolveTogglAuth({ togglApiToken: 'cfg-token' })).toEqual({
      apiToken: 'env-token',
    });
  });
});
