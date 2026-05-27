import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitEntry } from '../git.js';
import {
  extractSyncedShaFromDescription,
  fetchSyncedShas,
  findProjectId,
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

describe('extractSyncedShaFromDescription', () => {
  it('finds the SHA in a marker', () => {
    expect(
      extractSyncedShaFromDescription(
        'feat(ABC-123): add login (wdid abc1234)',
      ),
    ).toBe('abc1234');
  });

  it('returns null when no marker present', () => {
    expect(extractSyncedShaFromDescription('feat: add login')).toBeNull();
  });

  it('ignores markers that are not 7-char hex', () => {
    expect(extractSyncedShaFromDescription('(wdid xyz)')).toBeNull();
    expect(extractSyncedShaFromDescription('(wdid abc123)')).toBeNull();
  });
});

describe('planEntries', () => {
  const baseOptions = {
    date: '2026-05-27',
    defaultDurationMinutes: 30,
    dayStartHour: 9,
    projects: {},
    existingSyncedShas: new Set<string>(),
  };

  it('appends the SHA marker to each description', () => {
    const plan = planEntries(
      [commit({ sha: 'abc1234567', description: 'feat: a' })],
      baseOptions,
    );
    expect(plan[0]!.description).toBe('feat: a (wdid abc1234)');
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
    // Stacked: 09:00, 09:30, 10:00 (30-min default duration)
    expect(plan.map(p => new Date(p.start).getHours())).toEqual([9, 9, 10]);
    expect(plan.map(p => new Date(p.start).getMinutes())).toEqual([0, 30, 0]);
  });

  it('orders chronologically (ascending) within the day', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), time: '14:00', description: 'a' }),
        commit({ sha: 'b'.repeat(40), time: '09:00', description: 'b' }),
        commit({ sha: 'c'.repeat(40), time: '11:00', description: 'c' }),
      ],
      baseOptions,
    );
    expect(plan.map(p => p.description)).toEqual([
      'b (wdid bbbbbbb)',
      'c (wdid ccccccc)',
      'a (wdid aaaaaaa)',
    ]);
  });

  it('maps tickets to projects via prefix', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), ticket: 'ABC-1' }),
        commit({ sha: 'b'.repeat(40), ticket: 'DEF-1' }),
        commit({ sha: 'c'.repeat(40), ticket: null }),
      ],
      {
        ...baseOptions,
        projects: { 'ABC-': 100, 'DEF-': 200 },
        defaultProjectId: 999,
      },
    );
    expect(plan.map(p => p.projectId)).toEqual([100, 200, 999]);
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

  it('honors a custom day start hour and duration', () => {
    const plan = planEntries(
      [
        commit({ sha: 'a'.repeat(40), description: 'a' }),
        commit({ sha: 'b'.repeat(40), description: 'b' }),
      ],
      { ...baseOptions, dayStartHour: 13, defaultDurationMinutes: 15 },
    );
    expect(new Date(plan[0]!.start).getHours()).toBe(13);
    expect(new Date(plan[0]!.start).getMinutes()).toBe(0);
    expect(new Date(plan[1]!.start).getHours()).toBe(13);
    expect(new Date(plan[1]!.start).getMinutes()).toBe(15);
  });
});

describe('fetchSyncedShas / pushEntries — mocked fetch', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts SHA markers from fetched entries', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { description: 'feat: a (wdid abc1234)' },
        { description: 'fix: b (wdid def5678)' },
        { description: 'manual entry — no marker' },
        { description: null },
      ],
    } as Response);

    const result = await fetchSyncedShas({ apiToken: 'token' }, '2026-05-27');

    expect(result).toEqual(new Set(['abc1234', 'def5678']));
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
      {
        date: '2026-05-27',
        defaultDurationMinutes: 30,
        dayStartHour: 9,
        projects: {},
        existingSyncedShas: new Set(['aaaaaaa']),
      },
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
      {
        date: '2026-05-27',
        defaultDurationMinutes: 30,
        dayStartHour: 9,
        projects: {},
        existingSyncedShas: new Set(),
      },
    );

    const result = await pushEntries({ apiToken: 'token' }, 12345, plan);

    expect(result.pushed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.reason).toMatch(/400/);
  });
});
