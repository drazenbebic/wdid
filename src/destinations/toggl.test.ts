import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitEntry } from '../sources/git.js';
import {
  cleanSubjectForToggl,
  enumerateDates,
  extractSyncedShasFromDescription,
  fetchSyncedShas,
  findProjectId,
  MAX_SYNC_RANGE_DAYS,
  planEntries,
  pushEntries,
  shortenSha,
} from './toggl.js';

function commit(overrides: Partial<CommitEntry> = {}): CommitEntry {
  return {
    sha: 'abc1234567890',
    date: '2026-05-27',
    time: '14:30',
    ticket: null,
    description: 'chore: bump deps',
    branch: null,
    ...overrides,
  };
}

const baseOptions = {
  date: '2026-05-27',
  defaultDurationMinutes: 30,
  dayStartHour: 9,
  projects: {},
  existingSyncedShas: new Set<string>(),
  oneEntryPerTicket: false,
};

describe('enumerateDates', () => {
  it('returns a single date when from === to', () => {
    expect(enumerateDates('2026-05-27', '2026-05-27')).toEqual(['2026-05-27']);
  });

  it('enumerates inclusive of both endpoints', () => {
    expect(enumerateDates('2026-05-25', '2026-05-27')).toEqual([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
    ]);
  });

  it('handles month and year boundaries', () => {
    expect(enumerateDates('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('rejects --to before --from', () => {
    expect(() => enumerateDates('2026-05-27', '2026-05-25')).toThrow(
      /must be on or after/,
    );
  });

  it('rejects ranges longer than the limit', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + MAX_SYNC_RANGE_DAYS);
    const endStr = end.toISOString().slice(0, 10);
    expect(() => enumerateDates('2026-01-01', endStr)).toThrow(/limit is/);
  });

  it('accepts ranges exactly at the limit', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + MAX_SYNC_RANGE_DAYS - 1);
    const endStr = end.toISOString().slice(0, 10);
    expect(enumerateDates('2026-01-01', endStr)).toHaveLength(
      MAX_SYNC_RANGE_DAYS,
    );
  });
});

describe('shortenSha', () => {
  it('takes the first 7 characters', () => {
    expect(shortenSha('abc1234567890')).toBe('abc1234');
  });
});

describe('findProjectId', () => {
  it('returns the default when no ticket', () => {
    const result = findProjectId(null, { 'ABC-': 1 }, 99);
    expect(result).toEqual({ projectId: 99, matchedPrefix: null });
  });

  it('matches a prefix', () => {
    const result = findProjectId('ABC-123', { 'ABC-': 1 }, 99);
    expect(result).toEqual({ projectId: 1, matchedPrefix: 'ABC-' });
  });

  it('prefers the longest matching prefix', () => {
    const result = findProjectId('ABC-9999', { 'ABC-': 1, 'ABC-9': 2 }, 99);
    expect(result).toEqual({ projectId: 2, matchedPrefix: 'ABC-9' });
  });

  it('falls back to default when no prefix matches', () => {
    const result = findProjectId('XYZ-1', { 'ABC-': 1 }, 99);
    expect(result).toEqual({ projectId: 99, matchedPrefix: null });
  });

  it('returns null when no match and no default', () => {
    const result = findProjectId('XYZ-1', { 'ABC-': 1 });
    expect(result).toEqual({ projectId: null, matchedPrefix: null });
  });
});

describe('extractSyncedShasFromDescription', () => {
  it('finds a single SHA marker', () => {
    expect(
      extractSyncedShasFromDescription('feat: add login (wdid abc1234)'),
    ).toEqual(['abc1234']);
  });

  it('finds multiple SHA markers in order', () => {
    expect(
      extractSyncedShasFromDescription(
        'feat: a; fix: b (wdid abc1234) (wdid def5678)',
      ),
    ).toEqual(['abc1234', 'def5678']);
  });

  it('returns an empty array when no markers', () => {
    expect(extractSyncedShasFromDescription('feat: add login')).toEqual([]);
  });

  it('ignores malformed markers', () => {
    expect(extractSyncedShasFromDescription('(wdid xyz)')).toEqual([]);
    expect(extractSyncedShasFromDescription('(wdid abc123)')).toEqual([]);
  });
});

describe('cleanSubjectForToggl', () => {
  it('strips conventional-commit prefix when no ticket', () => {
    expect(cleanSubjectForToggl('fix: handle empty payload', null)).toBe(
      'handle empty payload',
    );
  });

  it('strips conventional-commit prefix with scope', () => {
    expect(
      cleanSubjectForToggl('chore(EN-4435): remove requestBody', 'EN-4435'),
    ).toBe('remove requestBody');
  });

  it('strips breaking-change marker', () => {
    expect(
      cleanSubjectForToggl('feat(ABC-123)!: breaking change', 'ABC-123'),
    ).toBe('breaking change');
  });

  it('strips a redundant leading ticket reference', () => {
    expect(cleanSubjectForToggl('EN-4435 quick fix', 'EN-4435')).toBe(
      'quick fix',
    );
    expect(cleanSubjectForToggl('EN-4435: quick fix', 'EN-4435')).toBe(
      'quick fix',
    );
  });

  it('strips both prefix and leading ticket', () => {
    expect(cleanSubjectForToggl('chore: EN-4435 cleanup', 'EN-4435')).toBe(
      'cleanup',
    );
  });

  it('leaves non-conventional subjects untouched', () => {
    expect(cleanSubjectForToggl('Refactor logging system', null)).toBe(
      'Refactor logging system',
    );
  });
});

describe('planEntries — commit granularity (oneEntryPerTicket=false)', () => {
  it('strips the conventional prefix and appends the SHA marker', () => {
    const plan = planEntries(
      [commit({ sha: 'abc1234567', description: 'feat: a' })],
      baseOptions,
    );
    expect(plan[0]!.description).toBe('a (wdid abc1234)');
  });

  it('prefixes with the ticket when one is present', () => {
    const plan = planEntries(
      [
        commit({
          sha: 'abc1234567',
          ticket: 'EN-4435',
          description: 'chore(EN-4435): remove requestBody',
        }),
      ],
      baseOptions,
    );
    expect(plan[0]!.description).toBe(
      'EN-4435: remove requestBody (wdid abc1234)',
    );
  });

  it('emits one plan entry per commit', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), ticket: 'ABC-1', description: 'a' }),
        commit({ sha: 'b'.repeat(40), ticket: 'ABC-1', description: 'b' }),
        commit({ sha: 'c'.repeat(40), ticket: 'DEF-1', description: 'c' }),
      ],
      baseOptions,
    );
    expect(plan).toHaveLength(3);
    expect(plan.map(p => p.commitCount)).toEqual([1, 1, 1]);
  });

  it('stacks entries from the day start hour', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), time: '10:00', description: 'a' }),
        commit({ sha: 'b'.repeat(40), time: '11:00', description: 'b' }),
        commit({ sha: 'c'.repeat(40), time: '12:00', description: 'c' }),
      ],
      baseOptions,
    );
    expect(plan.map(p => new Date(p.start).getHours())).toEqual([9, 9, 10]);
    expect(plan.map(p => new Date(p.start).getMinutes())).toEqual([0, 30, 0]);
  });

  it('marks entries as already synced when their SHA is in the set', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), description: 'a' }),
        commit({ sha: 'b'.repeat(40), description: 'b' }),
      ],
      { ...baseOptions, existingSyncedShas: new Set(['aaaaaaa']) },
    );
    expect(plan[0]!.alreadySynced).toBe(true);
    expect(plan[1]!.alreadySynced).toBe(false);
  });
});

describe('planEntries — ticket granularity (oneEntryPerTicket=true)', () => {
  const opts = { ...baseOptions, oneEntryPerTicket: true };

  it('aggregates commits with the same ticket into one entry', () => {
    const plan = planEntries(
      [
        commit({
          sha: 'a'.repeat(40),
          ticket: 'ABC-1',
          description: 'feat: a',
          time: '09:00',
        }),
        commit({
          sha: 'b'.repeat(40),
          ticket: 'ABC-1',
          description: 'fix: b',
          time: '10:00',
        }),
      ],
      opts,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]!.commitCount).toBe(2);
    expect(plan[0]!.description).toBe(
      'ABC-1: a; b (wdid aaaaaaa) (wdid bbbbbbb)',
    );
    expect(plan[0]!.shas).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
  });

  it('keeps no-ticket commits as separate 1:1 entries', () => {
    const plan = planEntries(
      [
        commit({
          sha: 'a'.repeat(40),
          ticket: null,
          description: 'chore: a',
        }),
        commit({
          sha: 'b'.repeat(40),
          ticket: null,
          description: 'chore: b',
        }),
      ],
      opts,
    );
    expect(plan).toHaveLength(2);
    expect(plan.map(p => p.commitCount)).toEqual([1, 1]);
  });

  it('scales duration by commit count per group', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), ticket: 'ABC-1', description: 'a' }),
        commit({ sha: 'b'.repeat(40), ticket: 'ABC-1', description: 'b' }),
        commit({ sha: 'c'.repeat(40), ticket: 'ABC-1', description: 'c' }),
      ],
      opts,
    );
    expect(plan[0]!.durationSeconds).toBe(3 * 30 * 60);
  });

  it('marks a group as alreadySynced only when all its SHAs are known', () => {
    const optsWithOne = {
      ...opts,
      existingSyncedShas: new Set(['aaaaaaa']),
    };
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), ticket: 'ABC-1', description: 'a' }),
        commit({ sha: 'b'.repeat(40), ticket: 'ABC-1', description: 'b' }),
      ],
      optsWithOne,
    );
    // ABC-1 group has [aaaaaaa, bbbbbbb], only aaaaaaa is in the set → not all synced
    expect(plan[0]!.alreadySynced).toBe(false);

    const optsWithBoth = {
      ...opts,
      existingSyncedShas: new Set(['aaaaaaa', 'bbbbbbb']),
    };
    const planAll = planEntries(
      [
        commit({ sha: 'a'.repeat(40), ticket: 'ABC-1', description: 'a' }),
        commit({ sha: 'b'.repeat(40), ticket: 'ABC-1', description: 'b' }),
      ],
      optsWithBoth,
    );
    expect(planAll[0]!.alreadySynced).toBe(true);
  });
});

describe('planEntries — ignoreSubjectPattern', () => {
  it('skips commits whose subject matches the ignore pattern', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), description: 'feat: add login' }),
        commit({
          sha: 'b'.repeat(40),
          description: "Merge branch 'feat/login'",
        }),
        commit({
          sha: 'c'.repeat(40),
          description: 'Merge pull request #42',
        }),
      ],
      { ...baseOptions, ignoreSubjectPattern: /\bmerge\b/i },
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]!.description).toContain('add login');
  });

  it('does not skip when no pattern is provided', () => {
    const plan = planEntries(
      [
        commit({
          sha: 'a'.repeat(40),
          description: "Merge branch 'main'",
        }),
      ],
      baseOptions,
    );
    expect(plan).toHaveLength(1);
  });
});

describe('fetchSyncedShas / pushEntries — mocked fetch', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts SHA markers from fetched entries (including multi-SHA)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { description: 'feat: a (wdid abc1234)' },
        { description: 'feat: b; fix: c (wdid def5678) (wdid 9abcdef)' },
        { description: 'manual entry — no marker' },
        { description: null },
      ],
    } as Response);

    const result = await fetchSyncedShas({ apiToken: 'token' }, '2026-05-27');

    expect(result).toEqual(new Set(['abc1234', 'def5678', '9abcdef']));
  });

  it('throws on non-ok fetch response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(
      fetchSyncedShas({ apiToken: 'bad' }, '2026-05-27'),
    ).rejects.toThrow(/401 Unauthorized/);
  });

  it('skips entries marked alreadySynced when pushing', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' } as Response);

    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), description: 'a' }),
        commit({ sha: 'b'.repeat(40), description: 'b' }),
      ],
      { ...baseOptions, existingSyncedShas: new Set(['aaaaaaa']) },
    );

    const result = await pushEntries({ apiToken: 'token' }, 12345, plan);

    expect(result.pushed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records failures and continues', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'invalid project_id',
      } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => '' } as Response);

    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), description: 'a' }),
        commit({ sha: 'b'.repeat(40), description: 'b' }),
      ],
      baseOptions,
    );

    const result = await pushEntries({ apiToken: 'token' }, 12345, plan);

    expect(result.pushed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toMatch(/400/);
  });
});
