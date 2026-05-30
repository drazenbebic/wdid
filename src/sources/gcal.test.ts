import { describe, expect, it } from 'vitest';
import {
  findProjectForEvent,
  planGcalEntries,
  shouldSkipEvent,
  type GcalEvent,
} from './gcal.js';

function event(overrides: Partial<GcalEvent> = {}): GcalEvent {
  return {
    id: 'evt_abc',
    summary: 'Team standup',
    status: 'confirmed',
    start: { dateTime: '2026-05-30T09:00:00Z' },
    end: { dateTime: '2026-05-30T09:30:00Z' },
    ...overrides,
  };
}

const noFilters = {
  skipDeclined: false,
  skipAllDay: false,
  ignoreTitlePattern: undefined,
};

describe('shouldSkipEvent', () => {
  it('keeps a normal confirmed event with no filters', () => {
    expect(shouldSkipEvent(event(), noFilters).skip).toBe(false);
  });

  it('skips cancelled events regardless of filters', () => {
    const result = shouldSkipEvent(event({ status: 'cancelled' }), noFilters);
    expect(result.skip).toBe(true);
    expect(result.reason).toBe('cancelled');
  });

  it('skips all-day events when skipAllDay is on', () => {
    const allDay = event({
      start: { date: '2026-05-30' },
      end: { date: '2026-05-31' },
    });
    expect(shouldSkipEvent(allDay, { ...noFilters, skipAllDay: true })).toEqual(
      { skip: true, reason: 'all-day' },
    );
  });

  it('keeps all-day events when skipAllDay is off', () => {
    const allDay = event({
      start: { date: '2026-05-30' },
      end: { date: '2026-05-31' },
    });
    expect(shouldSkipEvent(allDay, noFilters).skip).toBe(false);
  });

  it('skips events declined by the authorized user', () => {
    const declined = event({
      attendees: [
        { email: 'someone@x.com', responseStatus: 'accepted' },
        { self: true, responseStatus: 'declined' },
      ],
    });
    expect(
      shouldSkipEvent(declined, { ...noFilters, skipDeclined: true }),
    ).toEqual({ skip: true, reason: 'declined' });
  });

  it('does NOT skip events declined by someone else (only self matters)', () => {
    const otherDeclined = event({
      attendees: [
        { email: 'someone@x.com', responseStatus: 'declined' },
        { self: true, responseStatus: 'accepted' },
      ],
    });
    expect(
      shouldSkipEvent(otherDeclined, { ...noFilters, skipDeclined: true }).skip,
    ).toBe(false);
  });

  it('keeps events when the user is not in the attendee list', () => {
    // Solo events organized by the user — no `self: true` attendee — should
    // not be filtered as "declined."
    const solo = event({ attendees: undefined });
    expect(
      shouldSkipEvent(solo, { ...noFilters, skipDeclined: true }).skip,
    ).toBe(false);
  });

  it('skips events whose title matches the ignore pattern (case-insensitive)', () => {
    const ooo = event({ summary: 'OOO — vacation' });
    expect(
      shouldSkipEvent(ooo, {
        ...noFilters,
        ignoreTitlePattern: /\bOOO\b/i,
      }),
    ).toEqual({ skip: true, reason: 'title-ignored' });
  });
});

describe('findProjectForEvent', () => {
  it('returns the default when no patterns match', () => {
    const result = findProjectForEvent('Random meeting', { standup: 1 }, 99);
    expect(result).toEqual({ projectId: 99, matchedPattern: null });
  });

  it('matches case-insensitively', () => {
    const result = findProjectForEvent('Daily Standup', { standup: 1 }, 99);
    expect(result).toEqual({ projectId: 1, matchedPattern: 'standup' });
  });

  it('uses the first matching pattern when several would match', () => {
    // Object iteration order is insertion order in modern JS — so callers
    // can order more-specific patterns first to win.
    const result = findProjectForEvent(
      '1:1 with Alice',
      { '1:1': 5, alice: 6 },
      99,
    );
    expect(result).toEqual({ projectId: 5, matchedPattern: '1:1' });
  });

  it('returns null projectId when nothing matches and no default is set', () => {
    expect(findProjectForEvent('Random', {})).toEqual({
      projectId: null,
      matchedPattern: null,
    });
  });

  it('handles missing summary by returning the default', () => {
    expect(findProjectForEvent(undefined, { foo: 1 }, 99)).toEqual({
      projectId: 99,
      matchedPattern: null,
    });
  });

  it('silently skips invalid regex patterns', () => {
    // A bad pattern shouldn't crash the planner — just skip and try the next.
    const result = findProjectForEvent(
      'Standup',
      { '[invalid(': 1, standup: 2 },
      99,
    );
    expect(result).toEqual({ projectId: 2, matchedPattern: 'standup' });
  });
});

describe('planGcalEntries', () => {
  it('writes a (wdid gcal:<id>) marker into the description', () => {
    const plans = planGcalEntries(
      [event({ id: 'evt_42', summary: 'Standup' })],
      {
        filters: noFilters,
        projects: {},
        existingSyncedMarkers: new Set(),
      },
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]!.description).toBe('Standup (wdid gcal:evt_42)');
  });

  it('marks events as already synced when their marker is in the set', () => {
    const plans = planGcalEntries([event({ id: 'evt_42' })], {
      filters: noFilters,
      projects: {},
      existingSyncedMarkers: new Set(['gcal:evt_42']),
    });
    expect(plans[0]!.alreadySynced).toBe(true);
  });

  it('does NOT match a git marker as a gcal marker (no cross-source collision)', () => {
    // Even if a Toggl entry contains "(wdid git:evt_42)" for some reason,
    // the gcal source must not treat that as "already synced" for event evt_42.
    const plans = planGcalEntries([event({ id: 'evt_42' })], {
      filters: noFilters,
      projects: {},
      existingSyncedMarkers: new Set(['git:evt_42']),
    });
    expect(plans[0]!.alreadySynced).toBe(false);
  });

  it('computes duration from start/end in seconds', () => {
    const plans = planGcalEntries(
      [
        event({
          start: { dateTime: '2026-05-30T09:00:00Z' },
          end: { dateTime: '2026-05-30T10:30:00Z' },
        }),
      ],
      {
        filters: noFilters,
        projects: {},
        existingSyncedMarkers: new Set(),
      },
    );
    expect(plans[0]!.durationSeconds).toBe(90 * 60);
  });

  it('emits source=gcal on every plan', () => {
    const plans = planGcalEntries([event(), event({ id: 'evt_2' })], {
      filters: noFilters,
      projects: {},
      existingSyncedMarkers: new Set(),
    });
    expect(plans.every(p => p.source === 'gcal')).toBe(true);
  });

  it('filters out skipped events before returning plans', () => {
    const plans = planGcalEntries(
      [
        event({ id: 'evt_1', status: 'cancelled' }),
        event({ id: 'evt_2', summary: 'Real meeting' }),
      ],
      {
        filters: noFilters,
        projects: {},
        existingSyncedMarkers: new Set(),
      },
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]!.shas).toEqual(['evt_2']);
  });

  it('falls back to "(untitled meeting)" when summary is missing', () => {
    const plans = planGcalEntries([event({ summary: undefined })], {
      filters: noFilters,
      projects: {},
      existingSyncedMarkers: new Set(),
    });
    expect(plans[0]!.description).toContain('(untitled meeting)');
  });
});
