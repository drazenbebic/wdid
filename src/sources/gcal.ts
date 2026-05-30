import type { TogglEntryPlan } from '../destinations/toggl.js';
import { buildMarker, markerKey } from '../destinations/toggl.js';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GcalEvent {
  id: string;
  summary?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{
    email?: string;
    self?: boolean;
    responseStatus?: string; // "needsAction" | "declined" | "tentative" | "accepted"
  }>;
  organizer?: { email?: string; self?: boolean };
}

export interface GcalFilterOptions {
  skipDeclined: boolean;
  skipAllDay: boolean;
  ignoreTitlePattern?: RegExp;
}

/**
 * Decide whether a single event should be skipped per the configured filters.
 *
 * "Declined" specifically means the *authorized user* declined it; we look
 * for an attendee with `self: true` and `responseStatus: 'declined'`. If the
 * user isn't in the attendee list (they organized a solo event, or it's on a
 * calendar they own without RSVP), we don't have a decline to honor.
 */
export function shouldSkipEvent(
  event: GcalEvent,
  filters: GcalFilterOptions,
): { skip: boolean; reason?: string } {
  if (event.status === 'cancelled') {
    return { skip: true, reason: 'cancelled' };
  }

  if (filters.skipAllDay && event.start.dateTime === undefined) {
    return { skip: true, reason: 'all-day' };
  }

  if (filters.skipDeclined) {
    const self = event.attendees?.find(a => a.self === true);

    if (self?.responseStatus === 'declined') {
      return { skip: true, reason: 'declined' };
    }
  }

  if (filters.ignoreTitlePattern && event.summary) {
    if (filters.ignoreTitlePattern.test(event.summary)) {
      return { skip: true, reason: 'title-ignored' };
    }
  }

  return { skip: false };
}

/**
 * Resolve a Toggl project ID for an event by matching its summary against
 * the configured `gcalProjects` regex map. First match wins (iteration order
 * is config-declaration order).
 */
export function findProjectForEvent(
  summary: string | undefined,
  projects: Record<string, number>,
  defaultProjectId?: number,
): { projectId: number | null; matchedPattern: string | null } {
  if (!summary) {
    return { projectId: defaultProjectId ?? null, matchedPattern: null };
  }

  for (const [pattern, projectId] of Object.entries(projects)) {
    let re: RegExp;

    try {
      re = new RegExp(pattern, 'i');
    } catch {
      // Skip invalid regex patterns — surface the issue elsewhere if needed.
      continue;
    }

    if (re.test(summary)) {
      return { projectId, matchedPattern: pattern };
    }
  }

  return { projectId: defaultProjectId ?? null, matchedPattern: null };
}

function startEnd(event: GcalEvent): {
  start: string;
  durationSeconds: number;
} {
  // For non-all-day events, both dateTime fields are present in RFC3339.
  // For all-day events that slip through (skipAllDay=false), `date` is a
  // YYYY-MM-DD string with no time component — treat as midnight UTC and a
  // duration spanning to the end date.
  const startIso =
    event.start.dateTime ?? `${event.start.date ?? '1970-01-01'}T00:00:00Z`;
  const endIso =
    event.end.dateTime ?? `${event.end.date ?? '1970-01-01'}T00:00:00Z`;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const durationSeconds = Math.max(60, Math.round((endMs - startMs) / 1000));

  return { start: new Date(startMs).toISOString(), durationSeconds };
}

export interface GcalPlanOptions {
  filters: GcalFilterOptions;
  projects: Record<string, number>;
  defaultProjectId?: number;
  existingSyncedMarkers: Set<string>;
}

export function planGcalEntries(
  events: GcalEvent[],
  options: GcalPlanOptions,
): TogglEntryPlan[] {
  const plans: TogglEntryPlan[] = [];

  for (const event of events) {
    if (shouldSkipEvent(event, options.filters).skip) {
      continue;
    }

    const { start, durationSeconds } = startEnd(event);
    const { projectId, matchedPattern } = findProjectForEvent(
      event.summary,
      options.projects,
      options.defaultProjectId,
    );
    const description =
      `${(event.summary ?? '(untitled meeting)').trim()} ${buildMarker('gcal', [
        event.id,
      ])}`.trim();
    const alreadySynced = options.existingSyncedMarkers.has(
      markerKey('gcal', event.id),
    );

    plans.push({
      source: 'gcal',
      shas: [event.id],
      shortShas: [event.id],
      description,
      start,
      durationSeconds,
      projectId,
      matchedTicketPrefix: matchedPattern,
      ticket: null,
      commitCount: 1,
      alreadySynced,
    });
  }

  return plans;
}

/**
 * Fetch events from the user's primary calendar in [startOfDay, endOfDay].
 * Accepts a YYYY-MM-DD date; constructs the UTC day boundary internally so
 * the timezone is unambiguous (Google's `timeMin`/`timeMax` accept RFC3339).
 */
export async function fetchGcalEvents(
  accessToken: string,
  date: string,
): Promise<GcalEvent[]> {
  const timeMin = `${date}T00:00:00Z`;
  const timeMax = `${date}T23:59:59Z`;
  const url = new URL(`${CALENDAR_API_BASE}/calendars/primary/events`);
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true'); // expand recurring events
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google Calendar fetch failed: ${res.status} ${res.statusText} — ${text}`,
    );
  }

  const data = (await res.json()) as { items?: GcalEvent[] };

  return data.items ?? [];
}
