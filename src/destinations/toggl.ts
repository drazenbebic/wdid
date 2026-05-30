import type { CommitEntry } from '../sources/git.js';

const TOGGL_API_BASE = 'https://api.track.toggl.com/api/v9';

export interface TogglAuth {
  apiToken: string;
}

export interface TogglEntryPlan {
  shas: string[];
  shortShas: string[];
  description: string;
  start: string;
  durationSeconds: number;
  projectId: number | null;
  matchedTicketPrefix: string | null;
  ticket: string | null;
  commitCount: number;
  alreadySynced: boolean;
}

export interface PlanOptions {
  date: string;
  defaultDurationMinutes: number;
  dayStartHour: number;
  projects: Record<string, number>;
  defaultProjectId?: number;
  existingSyncedShas: Set<string>;
  oneEntryPerTicket: boolean;
  ignoreSubjectPattern?: RegExp;
}

export function shortenSha(sha: string): string {
  return sha.slice(0, 7);
}

export function findProjectId(
  ticket: string | null,
  projects: Record<string, number>,
  defaultProjectId?: number,
): { projectId: number | null; matchedPrefix: string | null } {
  if (!ticket) {
    return { projectId: defaultProjectId ?? null, matchedPrefix: null };
  }

  const prefixes = Object.keys(projects).sort((a, b) => b.length - a.length);

  for (const prefix of prefixes) {
    if (ticket.startsWith(prefix)) {
      return { projectId: projects[prefix] ?? null, matchedPrefix: prefix };
    }
  }

  return { projectId: defaultProjectId ?? null, matchedPrefix: null };
}

const SHA_MARKER_GLOBAL = /\(wdid ([0-9a-f]{7})\)/g;

export function extractSyncedShasFromDescription(
  description: string,
): string[] {
  const shas: string[] = [];

  for (const match of description.matchAll(SHA_MARKER_GLOBAL)) {
    if (match[1]) {
      shas.push(match[1]);
    }
  }

  return shas;
}

function groupKey(commit: CommitEntry, oneEntryPerTicket: boolean): string {
  // Commits with a ticket aggregate together when oneEntryPerTicket is on.
  // Commits without a ticket stay 1-per-entry by using their SHA as the key.
  if (oneEntryPerTicket && commit.ticket) {
    return `ticket:${commit.ticket}`;
  }

  return `sha:${commit.sha}`;
}

function buildMarker(shortShas: string[]): string {
  return shortShas.map(s => `(wdid ${s})`).join(' ');
}

const CONVENTIONAL_PREFIX = /^\w+(\([^)]+\))?!?:\s*/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cleanSubjectForToggl(
  rawSubject: string,
  ticket: string | null,
): string {
  let cleaned = rawSubject.replace(CONVENTIONAL_PREFIX, '');

  if (ticket) {
    // Strip a leading reference to the same ticket so we don't render it twice
    // (e.g. "EN-4435: foo" or "EN-4435 foo" after the conventional prefix is gone).
    const leadingTicket = new RegExp(`^${escapeRegExp(ticket)}[:\\s]+`);
    cleaned = cleaned.replace(leadingTicket, '');
  }

  return cleaned.trim();
}

export function planEntries(
  commits: CommitEntry[],
  options: PlanOptions,
): TogglEntryPlan[] {
  const filtered = options.ignoreSubjectPattern
    ? commits.filter(c => !options.ignoreSubjectPattern!.test(c.description))
    : commits;

  const sorted = [...filtered].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );

  // Group commits while preserving the order of the *first* commit in each group.
  const groups = new Map<string, CommitEntry[]>();
  for (const commit of sorted) {
    const key = groupKey(commit, options.oneEntryPerTicket);
    const existing = groups.get(key);

    if (existing) {
      existing.push(commit);
    } else {
      groups.set(key, [commit]);
    }
  }

  const defaultDurationSeconds = options.defaultDurationMinutes * 60;
  const dayStart = new Date(
    `${options.date}T${String(options.dayStartHour).padStart(2, '0')}:00:00`,
  );
  let cursor = dayStart.getTime();

  const plans: TogglEntryPlan[] = [];

  for (const groupCommits of groups.values()) {
    const first = groupCommits[0]!;
    const ticket = first.ticket;
    const shas = groupCommits.map(c => c.sha);
    const shortShas = shas.map(shortenSha);
    const cleanedSubjects = groupCommits
      .map(c => cleanSubjectForToggl(c.description, ticket))
      .filter(s => s.length > 0);
    const joined = cleanedSubjects.join('; ');
    const marker = buildMarker(shortShas);
    const body = ticket
      ? joined.length > 0
        ? `${ticket}: ${joined}`
        : ticket
      : joined;
    const description = `${body} ${marker}`.trim();
    const durationSeconds = defaultDurationSeconds * groupCommits.length;

    const { projectId, matchedPrefix } = findProjectId(
      ticket,
      options.projects,
      options.defaultProjectId,
    );

    const alreadySynced = shortShas.every(s =>
      options.existingSyncedShas.has(s),
    );

    plans.push({
      shas,
      shortShas,
      description,
      start: new Date(cursor).toISOString(),
      durationSeconds,
      projectId,
      matchedTicketPrefix: matchedPrefix,
      ticket,
      commitCount: groupCommits.length,
      alreadySynced,
    });

    cursor += durationSeconds * 1000;
  }

  return plans;
}

function basicAuth(token: string): string {
  return `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);

  return d.toISOString().slice(0, 10);
}

export const MAX_SYNC_RANGE_DAYS = 366;

export function enumerateDates(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`invalid date range "${from}" → "${to}"`);
  }

  if (end < start) {
    throw new Error(`--to (${to}) must be on or after --from (${from})`);
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  if (days > MAX_SYNC_RANGE_DAYS) {
    throw new Error(
      `date range is ${days} days; limit is ${MAX_SYNC_RANGE_DAYS}`,
    );
  }

  const result: string[] = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    result.push(d.toISOString().slice(0, 10));
  }

  return result;
}

export async function fetchSyncedShas(
  auth: TogglAuth,
  date: string,
): Promise<Set<string>> {
  const url = `${TOGGL_API_BASE}/me/time_entries?start_date=${date}&end_date=${nextDay(date)}`;
  const response = await fetch(url, {
    headers: { Authorization: basicAuth(auth.apiToken) },
  });

  if (!response.ok) {
    throw new Error(
      `Toggl fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const entries = (await response.json()) as Array<{
    description?: string | null;
  }>;
  const shas = new Set<string>();

  for (const e of entries) {
    for (const sha of extractSyncedShasFromDescription(e.description ?? '')) {
      shas.add(sha);
    }
  }

  return shas;
}

export interface PushResult {
  pushed: number;
  skipped: number;
  failures: Array<{ plan: TogglEntryPlan; reason: string }>;
}

export async function pushEntries(
  auth: TogglAuth,
  workspaceId: number,
  plan: TogglEntryPlan[],
): Promise<PushResult> {
  const result: PushResult = { pushed: 0, skipped: 0, failures: [] };

  for (const entry of plan) {
    if (entry.alreadySynced) {
      result.skipped++;
      continue;
    }

    const response = await fetch(
      `${TOGGL_API_BASE}/workspaces/${workspaceId}/time_entries`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: basicAuth(auth.apiToken),
        },
        body: JSON.stringify({
          description: entry.description,
          start: entry.start,
          duration: entry.durationSeconds,
          workspace_id: workspaceId,
          project_id: entry.projectId,
          created_with: 'wdid',
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      result.failures.push({
        plan: entry,
        reason: `${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
      });
      continue;
    }

    result.pushed++;
  }

  return result;
}
