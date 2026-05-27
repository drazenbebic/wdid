import type { CommitEntry } from '../git.js';

const TOGGL_API_BASE = 'https://api.track.toggl.com/api/v9';

export interface TogglAuth {
  apiToken: string;
}

export interface TogglEntryPlan {
  sha: string;
  shortSha: string;
  description: string;
  start: string;
  durationSeconds: number;
  projectId: number | null;
  matchedTicketPrefix: string | null;
  alreadySynced: boolean;
}

export interface PlanOptions {
  date: string;
  defaultDurationMinutes: number;
  dayStartHour: number;
  projects: Record<string, number>;
  defaultProjectId?: number;
  existingSyncedShas: Set<string>;
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

const SHA_MARKER = /\(wdid ([0-9a-f]{7})\)/;

export function extractSyncedShaFromDescription(
  description: string,
): string | null {
  const match = description.match(SHA_MARKER);

  return match?.[1] ?? null;
}

export function planEntries(
  commits: CommitEntry[],
  options: PlanOptions,
): TogglEntryPlan[] {
  const sorted = [...commits].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );

  const durationSeconds = options.defaultDurationMinutes * 60;
  const dayStart = new Date(
    `${options.date}T${String(options.dayStartHour).padStart(2, '0')}:00:00`,
  );
  let cursor = dayStart.getTime();

  return sorted.map(commit => {
    const shortSha = shortenSha(commit.sha);
    const description = `${commit.description} (wdid ${shortSha})`;
    const { projectId, matchedPrefix } = findProjectId(
      commit.ticket,
      options.projects,
      options.defaultProjectId,
    );

    const plan: TogglEntryPlan = {
      sha: commit.sha,
      shortSha,
      description,
      start: new Date(cursor).toISOString(),
      durationSeconds,
      projectId,
      matchedTicketPrefix: matchedPrefix,
      alreadySynced: options.existingSyncedShas.has(shortSha),
    };

    cursor += durationSeconds * 1000;

    return plan;
  });
}

function basicAuth(token: string): string {
  return `Basic ${Buffer.from(`${token}:api_token`).toString('base64')}`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);

  return d.toISOString().slice(0, 10);
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
    const sha = extractSyncedShaFromDescription(e.description ?? '');

    if (sha) {
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
